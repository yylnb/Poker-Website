// server/index.js
import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// rooms 数据结构说明见注释
const rooms = {};

function generateDeck() {
  const suits = ["♠", "♥", "♣", "♦"];
  const values = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const deck = [];
  for (const s of suits) {
    for (const v of values) {
      deck.push(v + s);
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function findPlayerIndex(room, socketId) {
  return room.players.findIndex((p) => p.id === socketId);
}

function getNextActiveIndex(room, startIndex) {
  const n = room.players.length;
  if (n === 0) return -1;
  let i = (startIndex + 1) % n;
  for (let k = 0; k < n; k++, i = (i + 1) % n) {
    const p = room.players[i];
    if (!p.folded && p.chips > 0) return i;
  }
  return -1;
}

function advanceTurn(room) {
  if (!room || !room.players || room.players.length === 0) {
    room.currentTurnId = null;
    return;
  }

  // 如果没有 currentTurnId -> 选第一个可行动者
  if (!room.currentTurnId) {
    const idx = room.players.findIndex((p) => !p.folded && p.chips > 0);
    room.currentTurnId = idx >= 0 ? room.players[idx].id : null;
    return;
  }

  const curIndex = findPlayerIndex(room, room.currentTurnId);
  const nextIndex = getNextActiveIndex(room, curIndex);
  if (nextIndex === -1) {
    room.currentTurnId = null;
  } else {
    room.currentTurnId = room.players[nextIndex].id;
  }
}

// 将玩家加入 playersActed（数组，不是 Set）
function markPlayerActed(room, playerId) {
  if (!room.playersActed) room.playersActed = [];
  if (!room.playersActed.includes(playerId)) room.playersActed.push(playerId);
}

// 判断本轮下注是否结束（改进：要求 active 非 all-in 的玩家既 matched 又 acted）
function checkBettingRoundEnd(room) {
  if (!room.bettingRoundActive) return false;

  const activePlayers = room.players.filter(p => !p.folded);

  for (const p of activePlayers) {
    const isAllIn = (p.chips === 0);
    const matched = ((p.currentBet || 0) === (room.currentMaxBet || 0));
    const acted = (room.playersActed || []).includes(p.id);
    if (!isAllIn) {
      if (!(matched && acted)) {
        return false;
      }
    } else {
      // all-in: treat as satisfied
      continue;
    }
  }

  // 如果所有未弃牌玩家都满足条件 -> 结束本轮
  room.bettingRoundActive = false;
  room.currentTurnId = null;

  io.to(room.id).emit("bettingRoundEnded", {
    ...room,
    playersActed: room.playersActed || []
  });

  return true;
}

/* ----------------
  牌力评估与比较（与先前实现兼容）
-----------------*/

const RANK_MAP = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14
};

function parseCard(card) {
  const suit = card.slice(-1);
  const value = card.slice(0, -1);
  const rank = RANK_MAP[value];
  return { card, suit, value, rank };
}

function uniqSortedDesc(arr) {
  return Array.from(new Set(arr)).sort((a, b) => b - a);
}

function highestStraight(ranks) {
  const uniq = Array.from(new Set(ranks)).sort((a, b) => a - b);
  const extended = uniq.slice();
  if (uniq.includes(14)) extended.unshift(1);

  let best = -1;
  for (let i = 0; i <= extended.length - 5; i++) {
    let ok = true;
    for (let k = 0; k < 4; k++) {
      if (extended[i + k] + 1 !== extended[i + k + 1]) { ok = false; break; }
    }
    if (ok) {
      best = Math.max(best, extended[i + 4] === 1 ? 5 : extended[i + 4]);
    }
  }
  return best;
}

function evaluateBestFive(cards) {
  const parsed = cards.map(parseCard);
  const ranks = parsed.map(p => p.rank);
  const suits = parsed.map(p => p.suit);

  const rankCount = {};
  for (const r of ranks) rankCount[r] = (rankCount[r] || 0) + 1;
  const suitCount = {};
  for (const s of suits) suitCount[s] = (suitCount[s] || 0) + 1;

  let flushSuit = null;
  for (const s in suitCount) if (suitCount[s] >= 5) flushSuit = s;

  const uniqRanks = Array.from(new Set(ranks));
  const highStraight = highestStraight(uniqRanks);
  let straightFlushHigh = -1;
  if (flushSuit) {
    const flushRanks = parsed.filter(p => p.suit === flushSuit).map(p => p.rank);
    const sfHigh = highestStraight(Array.from(new Set(flushRanks)));
    if (sfHigh !== -1) straightFlushHigh = sfHigh;
  }

  const quads = Object.keys(rankCount).filter(k => rankCount[k] === 4).map(x => Number(x)).sort((a,b)=>b-a);
  const trips = Object.keys(rankCount).filter(k => rankCount[k] === 3).map(x => Number(x)).sort((a,b)=>b-a);
  const pairs = Object.keys(rankCount).filter(k => rankCount[k] === 2).map(x => Number(x)).sort((a,b)=>b-a);
  const singles = Object.keys(rankCount).filter(k => rankCount[k] === 1).map(x => Number(x)).sort((a,b)=>b-a);

  if (straightFlushHigh !== -1) {
    return { score: [8, straightFlushHigh], handName: `Straight Flush (top ${straightFlushHigh})` };
  }

  if (quads.length > 0) {
    const quadRank = quads[0];
    const kickers = uniqSortedDesc(ranks).filter(r => r !== quadRank);
    return { score: [7, quadRank, kickers[0]], handName: `Four of a Kind (${quadRank})` };
  }

  if (trips.length > 0 && (pairs.length > 0 || trips.length > 1)) {
    const threeRank = trips[0];
    let pairRank = -1;
    if (trips.length > 1) pairRank = trips[1];
    if (pairs.length > 0 && pairs[0] !== threeRank) pairRank = Math.max(pairRank, pairs[0]);
    if (pairRank === -1 && trips.length > 1) pairRank = trips[1];
    return { score: [6, threeRank, pairRank], handName: `Full House (${threeRank} over ${pairRank})` };
  }

  if (flushSuit) {
    const flushCardsRanks = parsed.filter(p => p.suit === flushSuit).map(p => p.rank).sort((a,b)=>b-a);
    const top5 = flushCardsRanks.slice(0,5);
    return { score: [5, ...top5], handName: `Flush` };
  }

  if (highStraight !== -1) {
    return { score: [4, highStraight], handName: `Straight (top ${highStraight})` };
  }

  if (trips.length > 0) {
    const threeRank = trips[0];
    const kickers = uniqSortedDesc(ranks).filter(r => r !== threeRank).slice(0,2);
    return { score: [3, threeRank, ...kickers], handName: `Three of a Kind (${threeRank})` };
  }

  if (pairs.length >= 2) {
    const pair1 = pairs[0], pair2 = pairs[1];
    const kickers = uniqSortedDesc(ranks).filter(r => r !== pair1 && r !== pair2).slice(0,1);
    return { score: [2, pair1, pair2, ...(kickers.length ? [kickers[0]] : [0])], handName: `Two Pair (${pair1} & ${pair2})` };
  }

  if (pairs.length === 1) {
    const pair1 = pairs[0];
    const kickers = uniqSortedDesc(ranks).filter(r => r !== pair1).slice(0,3);
    return { score: [1, pair1, ...kickers], handName: `One Pair (${pair1})` };
  }

  const top5 = uniqSortedDesc(ranks).slice(0,5);
  return { score: [0, ...top5], handName: `High Card (${top5[0]})` };
}

function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

/* ----------------
  Side-pot / showdown 处理
-----------------*/

// 计算一组 pots（main + side pots）并分配给胜者（考虑 fold）
function computeAndDistributePots(room) {
  // contributions 包含每位玩家在整手中投入到 pot 的总额（可能为 0）
  const contributions = {};
  for (const p of room.players) {
    contributions[p.id] = (p.totalContribution || 0);
  }

  // collect all positive unique contribution levels
  const levels = Array.from(new Set(Object.values(contributions).filter(v => v > 0))).sort((a,b)=>a-b);
  const pots = []; // 每个元素 { level, amount, eligiblePlayersIds }

  let prev = 0;
  for (const level of levels) {
    const involved = room.players.filter(p => contributions[p.id] >= level);
    const countInvolved = involved.length;
    const sliceAmount = (level - prev) * countInvolved;
    // eligible players for this pot are those involved AND not folded
    const eligible = involved.filter(p => !p.folded).map(p => ({ id: p.id, nickname: p.nickname }));
    pots.push({
      level,
      amount: sliceAmount,
      eligible
    });
    prev = level;
  }

  // Now for each pot, determine winner(s) among eligible players (must be NOT folded)
  const potResults = []; // { amount, winners: [{id,nickname,share,score,handName}] }
  for (const pot of pots) {
    // skip if no eligible players (rare but possible if all who contributed folded)
    if (!pot.eligible || pot.eligible.length === 0) continue;

    // evaluate each eligible player's score
    let bestScore = null;
    let bestPlayers = [];
    for (const e of pot.eligible) {
      const p = room.players.find(x => x.id === e.id);
      if (!p) continue;
      const allCards = [...(room.communityCards || []), ...(p.hand || [])];
      const { score, handName } = evaluateBestFive(allCards);
      e.score = score;
      e.handName = handName;
      if (!bestScore || compareScores(score, bestScore) === 1) {
        bestScore = score;
        bestPlayers = [e];
      } else if (compareScores(score, bestScore) === 0) {
        bestPlayers.push(e);
      }
    }

    // split pot.amount equally among bestPlayers
    const shareBase = Math.floor(pot.amount / bestPlayers.length);
    let remainder = pot.amount - shareBase * bestPlayers.length;

    const winners = [];
    // deterministic order: sort by id to assign remainder deterministically
    bestPlayers.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

    for (const bp of bestPlayers) {
      const share = shareBase + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      // add to player's chips
      const playerObj = room.players.find(p => p.id === bp.id);
      if (playerObj) {
        playerObj.chips += share;
      }
      winners.push({
        id: bp.id,
        nickname: bp.nickname,
        share,
        score: bp.score,
        handName: bp.handName
      });
    }

    potResults.push({
      amount: pot.amount,
      winners
    });
  }

  // After distributing, clear room.pot and reset players' totalContribution/currentBet
  room.pot = 0;
  for (const p of room.players) {
    p.totalContribution = 0;
    p.currentBet = 0;
  }

  return potResults;
}

/* ----------------
  事件处理（下注 / 回合 / showdonw）
-----------------*/

io.on("connection", (socket) => {
  console.log("用户连接:", socket.id);

  // 加入房间
  socket.on("joinRoom", ({ roomId, nickname }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        ownerId: socket.id,
        players: [],
        communityCards: [],
        stage: "preflop",
        deck: [],
        pot: 200, // 初始底池设为 200 (单位 K)
        currentMaxBet: 0,
        currentTurnId: null,
        playersActed: [],
        bettingRoundActive: false,
      };
    }

    const room = rooms[roomId];

    if (!room.players.find((p) => p.id === socket.id)) {
      room.players.push({
        id: socket.id,
        nickname,
        hand: [],
        chips: 3000,        // 初始筹码 3000 (表示 3000K)
        currentBet: 0,
        totalContribution: 0,
        folded: false,
      });
    }

    if (!room.ownerId) {
      room.ownerId = room.players[0]?.id || null;
    }

    socket.join(roomId);
    io.to(roomId).emit("roomData", room);
  });

  // 开始游戏（仅房主）
  socket.on("startGame", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.ownerId) {
      socket.emit("errorMessage", { message: "只有房主可以开始游戏" });
      return;
    }

    room.deck = generateDeck();
    room.communityCards = [];
    room.stage = "preflop";
    room.currentMaxBet = 0;
    room.playersActed = [];
    room.bettingRoundActive = true;

    room.players.forEach((player) => {
      player.hand = [room.deck.pop(), room.deck.pop()];
      player.currentBet = 0;
      player.totalContribution = 0;
      player.folded = false;
      if (typeof player.chips !== "number") player.chips = 3000;
    });

    const firstIdx = room.players.findIndex((p) => !p.folded && p.chips > 0);
    room.currentTurnId = firstIdx >= 0 ? room.players[firstIdx].id : null;

    io.to(roomId).emit("gameStarted", room);
    io.to(roomId).emit("turnUpdated", {
      currentTurnId: room.currentTurnId,
      currentTurnNickname: room.players.find(p => p.id === room.currentTurnId)?.nickname || null
    });
  });

  // 重启游戏（仅房主）：保留 chips，重设 pot=200，并发新牌
  socket.on("restartGame", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.ownerId) {
      socket.emit("errorMessage", { message: "只有房主可以重启游戏" });
      return;
    }

    room.deck = generateDeck();
    room.communityCards = [];
    room.stage = "preflop";
    room.currentMaxBet = 0;
    room.playersActed = [];
    room.bettingRoundActive = true;
    room.pot = 200; // reset pot to 200 (K)

    room.players.forEach((player) => {
      player.hand = [room.deck.pop(), room.deck.pop()];
      player.currentBet = 0;
      player.totalContribution = 0;
      player.folded = false;
      // chips 保持不变（carry chips）
    });

    const firstIdx = room.players.findIndex((p) => !p.folded && p.chips > 0);
    room.currentTurnId = firstIdx >= 0 ? room.players[firstIdx].id : null;

    io.to(roomId).emit("gameStarted", room);
    io.to(roomId).emit("turnUpdated", {
      currentTurnId: room.currentTurnId,
      currentTurnNickname: room.players.find(p => p.id === room.currentTurnId)?.nickname || null
    });
  });

  // 通用下注：需要是当前回合玩家
  socket.on("bet", ({ roomId, amount }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!room.bettingRoundActive) {
      socket.emit("errorMessage", { message: "当前不在下注回合" });
      return;
    }
    if (room.currentTurnId !== socket.id) {
      socket.emit("errorMessage", { message: "现在不是你的回合" });
      return;
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.folded) return;

    const put = Math.max(0, Math.min(amount, player.chips));
    if (put <= 0) {
      socket.emit("errorMessage", { message: "下注金额不合法" });
      return;
    }

    player.chips -= put;
    player.currentBet += put;
    player.totalContribution = (player.totalContribution || 0) + put;
    room.pot = (room.pot || 0) + put;

    if (player.currentBet > room.currentMaxBet) room.currentMaxBet = player.currentBet;

    markPlayerActed(room, player.id);

    io.to(roomId).emit("betPlaced", room);

    if (!checkBettingRoundEnd(room)) {
      advanceTurn(room);
      io.to(roomId).emit("turnUpdated", {
        currentTurnId: room.currentTurnId,
        currentTurnNickname: room.players.find(p => p.id === room.currentTurnId)?.nickname || null
      });
    }
  });

  // call：补齐到 currentMaxBet（或 all-in）
  socket.on("call", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!room.bettingRoundActive) {
      socket.emit("errorMessage", { message: "当前不在下注回合" });
      return;
    }
    if (room.currentTurnId !== socket.id) {
      socket.emit("errorMessage", { message: "现在不是你的回合" });
      return;
    }
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.folded) return;

    const need = Math.max(0, room.currentMaxBet - player.currentBet);
    const put = Math.min(need, player.chips);
    if (put <= 0) {
      socket.emit("errorMessage", { message: "无需跟注" });
      return;
    }

    player.chips -= put;
    player.currentBet += put;
    player.totalContribution = (player.totalContribution || 0) + put;
    room.pot = (room.pot || 0) + put;

    if (player.currentBet > room.currentMaxBet) room.currentMaxBet = player.currentBet;

    markPlayerActed(room, player.id);
    io.to(roomId).emit("betPlaced", room);

    if (!checkBettingRoundEnd(room)) {
      advanceTurn(room);
      io.to(roomId).emit("turnUpdated", {
        currentTurnId: room.currentTurnId,
        currentTurnNickname: room.players.find(p => p.id === room.currentTurnId)?.nickname || null
      });
    }
  });

  // raise：在跟注的基础上再加 raiseAmount
  socket.on("raise", ({ roomId, raiseAmount }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!room.bettingRoundActive) {
      socket.emit("errorMessage", { message: "当前不在下注回合" });
      return;
    }
    if (room.currentTurnId !== socket.id) {
      socket.emit("errorMessage", { message: "现在不是你的回合" });
      return;
    }
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.folded) return;

    const needToCall = Math.max(0, room.currentMaxBet - player.currentBet);
    const totalPut = needToCall + Math.max(0, raiseAmount || 0);
    const put = Math.min(totalPut, player.chips);
    if (put <= 0) {
      socket.emit("errorMessage", { message: "加注数必须大于 0" });
      return;
    }

    player.chips -= put;
    player.currentBet += put;
    player.totalContribution = (player.totalContribution || 0) + put;
    room.pot = (room.pot || 0) + put;

    if (player.currentBet > room.currentMaxBet) {
      room.currentMaxBet = player.currentBet;
      // raise 后其他玩家需要重新行动 -> 重置 playersActed 为仅包含 raiser
      room.playersActed = [player.id];
    } else {
      markPlayerActed(room, player.id);
    }

    io.to(roomId).emit("betPlaced", room);

    if (!checkBettingRoundEnd(room)) {
      advanceTurn(room);
      io.to(roomId).emit("turnUpdated", {
        currentTurnId: room.currentTurnId,
        currentTurnNickname: room.players.find(p => p.id === room.currentTurnId)?.nickname || null
      });
    }
  });

  // check
  socket.on("check", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!room.bettingRoundActive) {
      socket.emit("errorMessage", { message: "当前不在下注回合" });
      return;
    }
    if (room.currentTurnId !== socket.id) {
      socket.emit("errorMessage", { message: "现在不是你的回合" });
      return;
    }
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.folded) return;

    if ((player.currentBet || 0) !== (room.currentMaxBet || 0)) {
      socket.emit("errorMessage", { message: "不能 check，需要先跟注或加注" });
      return;
    }

    markPlayerActed(room, player.id);
    io.to(roomId).emit("playerChecked", { room });

    if (!checkBettingRoundEnd(room)) {
      advanceTurn(room);
      io.to(roomId).emit("turnUpdated", {
        currentTurnId: room.currentTurnId,
        currentTurnNickname: room.players.find(p => p.id === room.currentTurnId)?.nickname || null
      });
    }
  });

  // fold
  socket.on("fold", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!room.bettingRoundActive) {
      socket.emit("errorMessage", { message: "当前不在下注回合" });
      return;
    }
    if (room.currentTurnId !== socket.id) {
      socket.emit("errorMessage", { message: "现在不是你的回合" });
      return;
    }
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    player.folded = true;
    markPlayerActed(room, player.id);

    io.to(roomId).emit("playerFolded", room);

    // 如果只剩一个玩家未弃牌，则该玩家直接赢得底池
    const activePlayers = room.players.filter(p => !p.folded);
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      winner.chips += room.pot;
      const winnerId = winner.id;
      const winnerNickname = winner.nickname;
      room.pot = 0;
      room.stage = "showdown";
      io.to(roomId).emit("showdown", { pots: [{ amount: room.pot, winners: [{ id: winnerId, nickname: winnerNickname, share: room.pot }] }], room });
      return;
    }

    if (!checkBettingRoundEnd(room)) {
      advanceTurn(room);
      io.to(roomId).emit("turnUpdated", {
        currentTurnId: room.currentTurnId,
        currentTurnNickname: room.players.find(p => p.id === room.currentTurnId)?.nickname || null
      });
    }
  });

  // 下一阶段（仅房主）
  socket.on("nextStage", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.ownerId) {
      socket.emit("errorMessage", { message: "只有房主可以推进阶段" });
      return;
    }

    // 清空本轮 currentBet（下注已经即时加入 pot）
    room.players.forEach((p) => {
      p.currentBet = 0;
    });
    room.currentMaxBet = 0;

    if (room.stage === "preflop") {
      room.communityCards = [room.deck.pop(), room.deck.pop(), room.deck.pop()];
      room.stage = "flop";
    } else if (room.stage === "flop") {
      room.communityCards.push(room.deck.pop());
      room.stage = "turn";
    } else if (room.stage === "turn") {
      room.communityCards.push(room.deck.pop());
      room.stage = "river";
    } else if (room.stage === "river") {
      // 进入摊牌阶段 -> 计算 side-pot 并分配
      room.stage = "showdown";
      const potResults = computeAndDistributePots(room);
      io.to(roomId).emit("showdown", { pots: potResults, room });
      return;
    }

    // 新一轮下注初始化（如果不是 showdown）
    room.playersActed = [];
    room.bettingRoundActive = true;
    const firstIdx = room.players.findIndex((p) => !p.folded && p.chips > 0);
    room.currentTurnId = firstIdx >= 0 ? room.players[firstIdx].id : null;

    io.to(roomId).emit("stageUpdated", room);
    io.to(roomId).emit("turnUpdated", {
      currentTurnId: room.currentTurnId,
      currentTurnNickname: room.players.find(p => p.id === room.currentTurnId)?.nickname || null
    });
  });

  // 断开连接
  socket.on("disconnect", () => {
    console.log("用户断开:", socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const beforeLen = room.players.length;
      room.players = room.players.filter((p) => p.id !== socket.id);

      if (room.ownerId === socket.id) {
        room.ownerId = room.players.length > 0 ? room.players[0].id : null;
      }

      if (room.currentTurnId === socket.id) {
        advanceTurn(room);
      }

      if (room.players.length !== beforeLen) {
        io.to(roomId).emit("roomData", room);
        io.to(roomId).emit("turnUpdated", {
          currentTurnId: room.currentTurnId,
          currentTurnNickname: room.players.find(p => p.id === room.currentTurnId)?.nickname || null
        });
      }
    }
  });
});

// server.listen(3001, "192.168.1.11", () => {
//   console.log("✅ 服务器运行在 http://192.168.1.11:3001");
// });

server.listen(3001, "0.0.0.0", () => {
  console.log("✅ 服务器运行在 http://0.0.0.0:3001 （可从局域网访问）");
});
