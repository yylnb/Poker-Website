import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import { createDeepSeekProvider, runBotTurn } from "./aiPlayer.js";
import {
  GameError,
  addBot,
  applyPlayerAction,
  createHumanPlayer,
  createRoom,
  createRoomView,
  removeBot,
  selectNextHumanOwner,
  startHand,
} from "./gameEngine.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const rooms = {};
const aiProvider = createDeepSeekProvider();

app.get("/", (_request, response) => {
  response.send("Server is running");
});

function emitRoomEvent(room, eventName, extra = {}) {
  for (const viewer of room.players.filter((player) => !player.isBot)) {
    const roomView = createRoomView(room, viewer.id);
    if (eventName === "playerChecked") {
      io.to(viewer.id).emit(eventName, { room: roomView });
    } else if (eventName === "showdown") {
      io.to(viewer.id).emit(eventName, { pots: extra.pots || [], room: roomView });
    } else {
      io.to(viewer.id).emit(eventName, roomView);
    }
  }
}

function emitTurn(room) {
  const currentPlayer = room.players.find((player) => player.id === room.currentTurnId);
  io.to(room.id).emit("turnUpdated", {
    currentTurnId: room.currentTurnId,
    currentTurnNickname: currentPlayer?.nickname || null,
  });
}

function emitActionResult(room, result) {
  const eventName = result.action === "fold"
    ? "playerFolded"
    : result.action === "check"
      ? "playerChecked"
      : "betPlaced";
  emitRoomEvent(room, eventName);

  if (result.roundEnded) emitRoomEvent(room, "bettingRoundEnded");
  if (result.stageChanged && !result.showdown) emitRoomEvent(room, "stageUpdated");
  if (result.showdown) emitRoomEvent(room, "showdown", { pots: result.showdown });
  emitTurn(room);
}

function reportError(socket, error) {
  const message = error instanceof GameError ? error.message : "服务器处理失败";
  socket.emit("errorMessage", { message });
  if (!(error instanceof GameError)) console.error(error);
}

function scheduleBotTurn(room) {
  queueMicrotask(() => driveBotTurns(room));
}

async function driveBotTurns(room) {
  const bot = room.players.find((player) => player.id === room.currentTurnId && player.isBot);
  if (!bot || !room.handInProgress || room.aiTurnInFlight) return;

  room.aiTurnInFlight = true;
  io.to(room.id).emit("aiStatus", { botId: bot.id, status: "thinking" });

  try {
    const outcome = await runBotTurn(room, aiProvider);
    if (outcome.stale || outcome.skipped) return;

    if (outcome.error) {
      console.warn(`AI fallback for ${bot.nickname}:`, outcome.error.message);
    }
    emitActionResult(room, outcome.result);
    io.to(room.id).emit("aiAction", {
      botId: bot.id,
      action: outcome.decision.action,
      raiseAmount: outcome.decision.raiseAmount,
      message: outcome.decision.message,
      fallback: outcome.fallback,
    });
  } catch (error) {
    console.error("AI turn failed:", error);
  } finally {
    room.aiTurnInFlight = false;
    io.to(room.id).emit("aiStatus", { botId: bot.id, status: "idle" });
    if (room.players.some((player) => player.id === room.currentTurnId && player.isBot)) {
      scheduleBotTurn(room);
    }
  }
}

io.on("connection", (socket) => {
  console.log("用户连接:", socket.id);

  socket.on("joinRoom", ({ roomId, nickname }) => {
    try {
      const normalizedRoomId = String(roomId || "").trim();
      const normalizedNickname = String(nickname || "").trim().slice(0, 24);
      if (!normalizedRoomId || !normalizedNickname) {
        throw new GameError("昵称和房间号不能为空");
      }

      if (!rooms[normalizedRoomId]) rooms[normalizedRoomId] = createRoom(normalizedRoomId, socket.id);
      const room = rooms[normalizedRoomId];
      if (!room.players.some((player) => player.id === socket.id)) {
        room.players.push(createHumanPlayer(socket.id, normalizedNickname));
      }
      if (!room.ownerId) selectNextHumanOwner(room);

      socket.join(normalizedRoomId);
      emitRoomEvent(room, "roomData");
    } catch (error) {
      reportError(socket, error);
    }
  });

  socket.on("addBot", ({ roomId }) => {
    try {
      if (!aiProvider.configured) throw new GameError("AI 服务尚未配置");
      const room = rooms[roomId];
      if (!room) throw new GameError("房间不存在");
      addBot(room, socket.id);
      emitRoomEvent(room, "roomData");
    } catch (error) {
      reportError(socket, error);
    }
  });

  socket.on("removeBot", ({ roomId, botId }) => {
    try {
      const room = rooms[roomId];
      if (!room) throw new GameError("房间不存在");
      removeBot(room, socket.id, botId);
      emitRoomEvent(room, "roomData");
    } catch (error) {
      reportError(socket, error);
    }
  });

  socket.on("startGame", (roomId) => {
    try {
      const room = rooms[roomId];
      if (!room) throw new GameError("房间不存在");
      startHand(room, socket.id);
      emitRoomEvent(room, "gameStarted");
      emitTurn(room);
      scheduleBotTurn(room);
    } catch (error) {
      reportError(socket, error);
    }
  });

  socket.on("restartGame", ({ roomId }) => {
    try {
      const room = rooms[roomId];
      if (!room) throw new GameError("房间不存在");
      startHand(room, socket.id);
      emitRoomEvent(room, "gameStarted");
      emitTurn(room);
      scheduleBotTurn(room);
    } catch (error) {
      reportError(socket, error);
    }
  });

  const handleAction = (eventName, toAction) => {
    socket.on(eventName, (payload = {}) => {
      try {
        const room = rooms[payload.roomId];
        if (!room) throw new GameError("房间不存在");
        const result = applyPlayerAction(room, socket.id, toAction(payload));
        emitActionResult(room, result);
        scheduleBotTurn(room);
      } catch (error) {
        reportError(socket, error);
      }
    });
  };

  handleAction("bet", ({ amount }) => ({ action: "bet", amount }));
  handleAction("call", () => ({ action: "call" }));
  handleAction("raise", ({ raiseAmount }) => ({ action: "raise", raiseAmount }));
  handleAction("check", () => ({ action: "check" }));
  handleAction("fold", () => ({ action: "fold" }));

  socket.on("disconnect", () => {
    console.log("用户断开:", socket.id);
    for (const room of Object.values(rooms)) {
      const beforeLength = room.players.length;
      room.players = room.players.filter((player) => player.id !== socket.id);
      if (room.ownerId === socket.id) selectNextHumanOwner(room);

      if (room.currentTurnId === socket.id && room.handInProgress) {
        room.currentTurnId = room.players.find((player) => !player.folded && player.chips > 0)?.id || null;
        room.turnVersion += 1;
      }

      if (room.players.length !== beforeLength) {
        if (room.players.every((player) => player.isBot)) {
          delete rooms[room.id];
          continue;
        }
        emitRoomEvent(room, "roomData");
        emitTurn(room);
        scheduleBotTurn(room);
      }
    }
  });
});

// ============= 自动清理空房间 =============
// 定期删除没有玩家的房间，防止房间号被永久占用。
// 玩家全离开的空房间：1 小时后清理（给中途断线重连留时间）
// 有玩家但超过 24 小时的房间：也清理（防止僵尸房间）
setInterval(() => {
  const now = Date.now();
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (!room) continue;
    const isEmpty = !room.players || room.players.length === 0;
    const age = now - (room.createdAt || now);
    // 空房间超过 1 小时，或任何房间超过 24 小时
    if ((isEmpty && age > 60 * 60 * 1000) || age > 24 * 60 * 60 * 1000) {
      console.log(`🧹 自动清理房间: ${roomId} (players=${room.players?.length || 0}, age=${Math.round(age/60000)}min)`);
      delete rooms[roomId];
    }
  }
}, 30 * 60 * 1000); // 每 30 分钟检查一次

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`服务器运行在端口 ${PORT}`);
});
