import { randomUUID } from "node:crypto";

export const STARTING_CHIPS = 3000;
export const ANTE = 10;
export const MAX_BOTS = 3;

export class GameError extends Error {
  constructor(message, code = "GAME_ERROR") {
    super(message);
    this.name = "GameError";
    this.code = code;
  }
}

export function createRoom(id, ownerId) {
  return {
    id,
    ownerId,
    players: [],
    communityCards: [],
    stage: "preflop",
    deck: [],
    pot: 0,
    currentMaxBet: 0,
    currentTurnId: null,
    playersActed: [],
    bettingRoundActive: false,
    handInProgress: false,
    actionHistory: [],
    turnVersion: 0,
    aiTurnInFlight: false,
    createdAt: Date.now(),   // 房间创建时间（用于自动清理）
  };
}

export function createHumanPlayer(id, nickname) {
  return {
    id,
    nickname,
    hand: [],
    chips: STARTING_CHIPS,
    currentBet: 0,
    totalContribution: 0,
    folded: false,
    isBot: false,
  };
}

export function canManageBots(room) {
  return !room.handInProgress || room.stage === "showdown";
}

export function addBot(room, actorId) {
  assertOwner(room, actorId);
  if (!canManageBots(room)) {
    throw new GameError("只能在开局前或摊牌后添加 AI", "BOT_MANAGEMENT_LOCKED");
  }

  const bots = room.players.filter((player) => player.isBot);
  if (bots.length >= MAX_BOTS) {
    throw new GameError(`每个房间最多添加 ${MAX_BOTS} 个 AI`, "BOT_LIMIT_REACHED");
  }

  const usedSlots = new Set(bots.map((player) => player.botSlot));
  let botSlot = 1;
  while (usedSlots.has(botSlot)) botSlot += 1;

  const bot = {
    ...createHumanPlayer(`bot:${randomUUID()}`, `AI ${botSlot}`),
    isBot: true,
    botSlot,
  };
  room.players.push(bot);
  room.turnVersion += 1;
  return bot;
}

export function removeBot(room, actorId, botId) {
  assertOwner(room, actorId);
  if (!canManageBots(room)) {
    throw new GameError("只能在开局前或摊牌后移除 AI", "BOT_MANAGEMENT_LOCKED");
  }

  const index = room.players.findIndex((player) => player.id === botId && player.isBot);
  if (index === -1) {
    throw new GameError("找不到该 AI 玩家", "BOT_NOT_FOUND");
  }

  const [removed] = room.players.splice(index, 1);
  room.turnVersion += 1;
  return removed;
}

export function selectNextHumanOwner(room) {
  room.ownerId = room.players.find((player) => !player.isBot)?.id || null;
  return room.ownerId;
}

export function startHand(room, actorId) {
  assertOwner(room, actorId);
  if (room.handInProgress) {
    throw new GameError("当前牌局仍在进行中", "HAND_IN_PROGRESS");
  }

  const fundedPlayers = room.players.filter((player) => player.chips > 0);
  if (fundedPlayers.length < 2) {
    throw new GameError("至少需要两名有筹码的玩家才能开始游戏", "NOT_ENOUGH_PLAYERS");
  }

  room.deck = generateDeck();
  room.communityCards = [];
  room.stage = "ante";
  room.pot = 0;
  room.playersActed = [];
  room.bettingRoundActive = true;
  room.handInProgress = true;
  room.actionHistory = [];
  room.currentMaxBet = ANTE;

  for (const player of room.players) {
    player.hand = [];
    player.folded = false;
    player.currentBet = 0;
    player.totalContribution = 0;

    const ante = Math.min(ANTE, Math.max(0, player.chips));
    player.chips -= ante;
    player.currentBet = ante;
    player.totalContribution = ante;
    room.pot += ante;
  }

  const first = room.players.find((player) => !player.folded && player.chips > 0);
  room.currentTurnId = first?.id || null;
  room.turnVersion += 1;
  return room;
}

export function getLegalActions(room, playerId) {
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player || player.folded || player.chips <= 0 || room.currentTurnId !== playerId) {
    return [];
  }

  const toCall = Math.max(0, (room.currentMaxBet || 0) - (player.currentBet || 0));
  const actions = [{ action: "fold" }];

  if (toCall === 0) {
    actions.unshift({ action: "check" });
  } else {
    actions.unshift({ action: "call", amount: Math.min(toCall, player.chips) });
  }

  if (player.chips > toCall) {
    actions.push({
      action: "raise",
      minRaiseAmount: 1,
      maxRaiseAmount: player.chips - toCall,
    });
  }

  return actions;
}

export function applyPlayerAction(room, playerId, input) {
  if (!room.handInProgress || !room.bettingRoundActive) {
    throw new GameError("当前不在下注回合", "BETTING_INACTIVE");
  }
  if (room.currentTurnId !== playerId) {
    throw new GameError("现在不是你的回合", "NOT_YOUR_TURN");
  }

  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player || player.folded || player.chips <= 0) {
    throw new GameError("当前玩家无法行动", "PLAYER_CANNOT_ACT");
  }

  const action = String(input?.action || "").toLowerCase();
  let amount = 0;
  let actualRaiseAmount = 0;

  if (action === "check") {
    if ((player.currentBet || 0) !== (room.currentMaxBet || 0)) {
      throw new GameError("不能 check，需要先跟注或加注", "CHECK_NOT_ALLOWED");
    }
    markPlayerActed(room, player.id);
  } else if (action === "call") {
    const need = Math.max(0, (room.currentMaxBet || 0) - (player.currentBet || 0));
    amount = Math.min(need, player.chips);
    if (amount <= 0) {
      throw new GameError("无需跟注", "CALL_NOT_NEEDED");
    }
    commitChips(room, player, amount);
    markPlayerActed(room, player.id);
  } else if (action === "raise") {
    const requestedRaise = positiveInteger(input?.raiseAmount, "加注数必须大于 0");
    const needToCall = Math.max(0, (room.currentMaxBet || 0) - (player.currentBet || 0));
    amount = Math.min(needToCall + requestedRaise, player.chips);
    if (amount <= 0) {
      throw new GameError("加注数必须大于 0", "INVALID_RAISE");
    }

    const previousMax = room.currentMaxBet || 0;
    commitChips(room, player, amount);
    if (player.currentBet > previousMax) {
      actualRaiseAmount = player.currentBet - previousMax;
      room.currentMaxBet = player.currentBet;
      room.playersActed = [player.id];
    } else {
      markPlayerActed(room, player.id);
    }
  } else if (action === "bet") {
    amount = Math.min(positiveInteger(input?.amount, "下注金额不合法"), player.chips);
    if (amount <= 0) {
      throw new GameError("下注金额不合法", "INVALID_BET");
    }
    commitChips(room, player, amount);
    if (player.currentBet > room.currentMaxBet) room.currentMaxBet = player.currentBet;
    markPlayerActed(room, player.id);
  } else if (action === "fold") {
    player.folded = true;
    markPlayerActed(room, player.id);
  } else {
    throw new GameError("未知操作", "UNKNOWN_ACTION");
  }

  recordAction(room, player, action, amount, actualRaiseAmount);
  room.turnVersion += 1;

  const result = {
    action,
    playerId,
    amount,
    raiseAmount: actualRaiseAmount,
    roundEnded: false,
    stageChanged: false,
    showdown: null,
  };

  if (action === "fold") {
    const activePlayers = room.players.filter((candidate) => !candidate.folded);
    if (activePlayers.length === 1) {
      result.showdown = settleEarlyWin(room, activePlayers[0]);
      return result;
    }
  }

  if (bettingRoundEnded(room)) {
    result.roundEnded = true;
    const transition = advanceStage(room);
    result.stageChanged = transition.stageChanged;
    result.showdown = transition.showdown;
  } else {
    advanceTurn(room);
    room.turnVersion += 1;
  }

  return result;
}

export function createRoomView(room, viewerId) {
  const revealHands = room.stage === "showdown";
  return {
    id: room.id,
    ownerId: room.ownerId,
    players: room.players.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      hand: visibleHand(player, viewerId, revealHands),
      chips: player.chips,
      currentBet: player.currentBet || 0,
      folded: Boolean(player.folded),
      isBot: Boolean(player.isBot),
    })),
    communityCards: [...(room.communityCards || [])],
    stage: room.stage,
    pot: room.pot || 0,
    currentMaxBet: room.currentMaxBet || 0,
    currentTurnId: room.currentTurnId,
    bettingRoundActive: Boolean(room.bettingRoundActive),
    handInProgress: Boolean(room.handInProgress),
  };
}

export function buildAiGameState(room, botId) {
  const bot = room.players.find((player) => player.id === botId && player.isBot);
  if (!bot) throw new GameError("找不到 AI 玩家", "BOT_NOT_FOUND");

  return {
    rules: "自定义无限注德州：每人先下 10K 底注并行动，底注轮结束后才发两张底牌；raiseAmount 是补齐跟注后额外增加的筹码。",
    stage: room.stage,
    pot: room.pot || 0,
    currentMaxBet: room.currentMaxBet || 0,
    communityCards: [...(room.communityCards || [])],
    holeCards: [...(bot.hand || [])],
    self: {
      id: bot.id,
      nickname: bot.nickname,
      chips: bot.chips,
      currentBet: bot.currentBet || 0,
    },
    players: room.players.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      chips: player.chips,
      currentBet: player.currentBet || 0,
      folded: Boolean(player.folded),
      isBot: Boolean(player.isBot),
    })),
    legalActions: getLegalActions(room, botId),
    actionHistory: (room.actionHistory || []).map((entry) => ({ ...entry })),
  };
}

export function computeAndDistributePots(room) {
  const contributions = Object.fromEntries(
    room.players.map((player) => [player.id, player.totalContribution || 0]),
  );
  const levels = [...new Set(Object.values(contributions).filter((value) => value > 0))].sort((a, b) => a - b);
  const pots = [];
  let previousLevel = 0;

  for (const level of levels) {
    const involved = room.players.filter((player) => contributions[player.id] >= level);
    pots.push({
      amount: (level - previousLevel) * involved.length,
      eligible: involved.filter((player) => !player.folded),
    });
    previousLevel = level;
  }

  const results = [];
  for (const pot of pots) {
    if (pot.eligible.length === 0) continue;

    let bestScore = null;
    let winners = [];
    for (const player of pot.eligible) {
      const evaluation = evaluateBestFive([...(room.communityCards || []), ...(player.hand || [])]);
      const candidate = { player, ...evaluation };
      if (!bestScore || compareScores(evaluation.score, bestScore) > 0) {
        bestScore = evaluation.score;
        winners = [candidate];
      } else if (compareScores(evaluation.score, bestScore) === 0) {
        winners.push(candidate);
      }
    }

    winners.sort((left, right) => left.player.id.localeCompare(right.player.id));
    const baseShare = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - baseShare * winners.length;
    const awarded = winners.map((winner) => {
      const share = baseShare + (remainder-- > 0 ? 1 : 0);
      winner.player.chips += share;
      return {
        id: winner.player.id,
        nickname: winner.player.nickname,
        share,
        score: winner.score,
        handName: winner.handName,
      };
    });
    results.push({ amount: pot.amount, winners: awarded });
  }

  clearContributions(room);
  return results;
}

export function evaluateBestFive(cards) {
  const parsed = cards.map(parseCard);
  const ranks = parsed.map((card) => card.rank);
  const rankCount = countValues(ranks);
  const suitCount = countValues(parsed.map((card) => card.suit));
  const flushSuit = Object.keys(suitCount).find((suit) => suitCount[suit] >= 5) || null;
  const highStraight = highestStraight(ranks);
  const straightFlushHigh = flushSuit
    ? highestStraight(parsed.filter((card) => card.suit === flushSuit).map((card) => card.rank))
    : -1;
  const quads = ranksWithCount(rankCount, 4);
  const trips = ranksWithCount(rankCount, 3);
  const pairs = ranksWithCount(rankCount, 2);

  if (straightFlushHigh !== -1) return { score: [8, straightFlushHigh], handName: `Straight Flush (top ${straightFlushHigh})` };
  if (quads.length) {
    const kickers = uniqueDescending(ranks).filter((rank) => rank !== quads[0]);
    return { score: [7, quads[0], kickers[0]], handName: `Four of a Kind (${quads[0]})` };
  }
  if (trips.length && (pairs.length || trips.length > 1)) {
    const pairRank = Math.max(trips[1] || -1, pairs[0] || -1);
    return { score: [6, trips[0], pairRank], handName: `Full House (${trips[0]} over ${pairRank})` };
  }
  if (flushSuit) {
    const topFive = parsed.filter((card) => card.suit === flushSuit).map((card) => card.rank).sort((a, b) => b - a).slice(0, 5);
    return { score: [5, ...topFive], handName: "Flush" };
  }
  if (highStraight !== -1) return { score: [4, highStraight], handName: `Straight (top ${highStraight})` };
  if (trips.length) {
    const kickers = uniqueDescending(ranks).filter((rank) => rank !== trips[0]).slice(0, 2);
    return { score: [3, trips[0], ...kickers], handName: `Three of a Kind (${trips[0]})` };
  }
  if (pairs.length >= 2) {
    const kicker = uniqueDescending(ranks).find((rank) => rank !== pairs[0] && rank !== pairs[1]) || 0;
    return { score: [2, pairs[0], pairs[1], kicker], handName: `Two Pair (${pairs[0]} & ${pairs[1]})` };
  }
  if (pairs.length === 1) {
    const kickers = uniqueDescending(ranks).filter((rank) => rank !== pairs[0]).slice(0, 3);
    return { score: [1, pairs[0], ...kickers], handName: `One Pair (${pairs[0]})` };
  }

  const topFive = uniqueDescending(ranks).slice(0, 5);
  return { score: [0, ...topFive], handName: `High Card (${topFive[0]})` };
}

function assertOwner(room, actorId) {
  if (!room || actorId !== room.ownerId) {
    throw new GameError("只有房主可以执行此操作", "OWNER_ONLY");
  }
}

function generateDeck() {
  const suits = ["♠", "♥", "♣", "♦"];
  const values = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const deck = suits.flatMap((suit) => values.map((value) => value + suit));
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function positiveInteger(value, message) {
  const integer = Math.floor(Number(value));
  if (!Number.isFinite(integer) || integer <= 0) {
    throw new GameError(message, "INVALID_AMOUNT");
  }
  return integer;
}

function commitChips(room, player, amount) {
  player.chips -= amount;
  player.currentBet = (player.currentBet || 0) + amount;
  player.totalContribution = (player.totalContribution || 0) + amount;
  room.pot = (room.pot || 0) + amount;
}

function markPlayerActed(room, playerId) {
  if (!room.playersActed.includes(playerId)) room.playersActed.push(playerId);
}

function recordAction(room, player, action, amount, raiseAmount) {
  room.actionHistory.push({
    playerId: player.id,
    nickname: player.nickname,
    stage: room.stage,
    action,
    amount,
    raiseAmount,
  });
}

function bettingRoundEnded(room) {
  const activePlayers = room.players.filter((player) => !player.folded);
  const complete = activePlayers.every((player) => {
    if (player.chips === 0) return true;
    const matched = (player.currentBet || 0) === (room.currentMaxBet || 0);
    return matched && room.playersActed.includes(player.id);
  });

  if (complete) {
    room.bettingRoundActive = false;
    room.currentTurnId = null;
  }
  return complete;
}

function advanceTurn(room) {
  const currentIndex = room.players.findIndex((player) => player.id === room.currentTurnId);
  const total = room.players.length;
  for (let offset = 1; offset <= total; offset += 1) {
    const candidate = room.players[(currentIndex + offset + total) % total];
    if (!candidate.folded && candidate.chips > 0) {
      room.currentTurnId = candidate.id;
      return;
    }
  }
  room.currentTurnId = null;
}

function advanceStage(room) {
  let stageChanged = false;

  while (true) {
    room.players.forEach((player) => { player.currentBet = 0; });
    room.currentMaxBet = 0;

    if (room.stage === "ante") {
      for (const player of room.players) {
        if (!player.folded && player.hand.length === 0) {
          player.hand = [room.deck.pop(), room.deck.pop()];
        }
      }
      room.stage = "preflop";
    } else if (room.stage === "preflop") {
      room.communityCards = [room.deck.pop(), room.deck.pop(), room.deck.pop()];
      room.stage = "flop";
    } else if (room.stage === "flop") {
      room.communityCards.push(room.deck.pop());
      room.stage = "turn";
    } else if (room.stage === "turn") {
      room.communityCards.push(room.deck.pop());
      room.stage = "river";
    } else if (room.stage === "river") {
      return { stageChanged: true, showdown: settleShowdown(room) };
    } else {
      return { stageChanged, showdown: null };
    }

    stageChanged = true;
    room.playersActed = [];
    const actionable = room.players.filter((player) => !player.folded && player.chips > 0);
    if (actionable.length > 0) {
      room.bettingRoundActive = true;
      room.currentTurnId = actionable[0].id;
      room.turnVersion += 1;
      return { stageChanged, showdown: null };
    }
  }
}

function settleEarlyWin(room, winner) {
  const amount = room.pot || 0;
  winner.chips += amount;
  const pots = [{
    amount,
    winners: [{
      id: winner.id,
      nickname: winner.nickname,
      share: amount,
      handName: "未摊牌",
    }],
  }];
  clearContributions(room);
  finishHand(room);
  return pots;
}

function settleShowdown(room) {
  const pots = computeAndDistributePots(room);
  finishHand(room);
  return pots;
}

function finishHand(room) {
  room.stage = "showdown";
  room.handInProgress = false;
  room.bettingRoundActive = false;
  room.currentTurnId = null;
  room.currentMaxBet = 0;
  room.playersActed = [];
  room.aiTurnInFlight = false;
  room.turnVersion += 1;
}

function clearContributions(room) {
  room.pot = 0;
  for (const player of room.players) {
    player.totalContribution = 0;
    player.currentBet = 0;
  }
}

function visibleHand(player, viewerId, revealHands) {
  if (revealHands || player.id === viewerId) return [...(player.hand || [])];
  return player.hand?.length === 2 ? [null, null] : [];
}

const RANKS = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14 };

function parseCard(card) {
  const suit = card.slice(-1);
  const value = card.slice(0, -1);
  return { suit, rank: RANKS[value] };
}

function countValues(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function ranksWithCount(counts, count) {
  return Object.keys(counts).filter((rank) => counts[rank] === count).map(Number).sort((a, b) => b - a);
}

function uniqueDescending(ranks) {
  return [...new Set(ranks)].sort((a, b) => b - a);
}

function highestStraight(ranks) {
  const unique = [...new Set(ranks)].sort((a, b) => a - b);
  if (unique.includes(14)) unique.unshift(1);
  let best = -1;
  for (let index = 0; index <= unique.length - 5; index += 1) {
    if (unique.slice(index, index + 5).every((rank, offset, sequence) => offset === 0 || rank === sequence[offset - 1] + 1)) {
      best = Math.max(best, unique[index + 4]);
    }
  }
  return best;
}

function compareScores(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return 1;
    if ((left[index] || 0) < (right[index] || 0)) return -1;
  }
  return 0;
}
