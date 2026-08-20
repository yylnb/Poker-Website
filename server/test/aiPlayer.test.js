import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_COMMENT_LIMIT,
  AI_SYSTEM_PROMPT,
  conservativeFallback,
  parseAiDecision,
  runBotTurn,
} from "../aiPlayer.js";
import {
  addBot,
  applyPlayerAction,
  buildAiGameState,
  createHumanPlayer,
  createRoom,
  startHand,
} from "../gameEngine.js";

function roomAtBotTurn(botCount = 1) {
  const room = createRoom("ai-room", "human");
  room.players.push(createHumanPlayer("human", "真人"));
  for (let index = 0; index < botCount; index += 1) addBot(room, room.ownerId);
  startHand(room, room.ownerId);
  applyPlayerAction(room, "human", { action: "check" });
  return room;
}

test("AI JSON responses are validated and comments stay within 20 characters", () => {
  const legal = [{ action: "call", amount: 10 }, { action: "raise", minRaiseAmount: 1, maxRaiseAmount: 50 }];
  const longMessage = "这是一个明显超过二十个字符并且必须被截断的中文牌桌句子";
  const parsed = parseAiDecision(JSON.stringify({
    action: "raise",
    raiseAmount: 25,
    message: longMessage,
  }), legal);

  assert.equal(parsed.action, "raise");
  assert.equal(parsed.raiseAmount, 25);
  assert.equal(parsed.message, [...longMessage].slice(0, AI_COMMENT_LIMIT).join(""));
  assert.equal([...parsed.message].length, AI_COMMENT_LIMIT);
  assert.throws(() => parseAiDecision("", legal), /empty/);
  assert.throws(() => parseAiDecision("not-json", legal), SyntaxError);
  assert.throws(() => parseAiDecision('{"action":"check"}', legal), /illegal action/);
  assert.throws(() => parseAiDecision('{"action":"raise","raiseAmount":100}', legal), /raise amount/);
  assert.throws(() => parseAiDecision('{"action":"call","message":""}', legal), /empty comment/);
});

test("free-form AI comments are preserved without a phrase library", () => {
  const legal = [{ action: "raise", minRaiseAmount: 1, maxRaiseAmount: 50 }];
  const message = "今晚都挺谨慎嘛。";
  const decision = parseAiDecision(JSON.stringify({ action: "raise", raiseAmount: 25, message }), legal);

  assert.equal(decision.message, message);
});

test("the system prompt allows free comments but forbids revealing hole cards", () => {
  assert.match(AI_SYSTEM_PROMPT, /自由聊天、开玩笑、挑衅、虚张声势或表达情绪/);
  assert.match(AI_SYSTEM_PROMPT, /除保密要求外，不限制内容和风格/);
  assert.match(AI_SYSTEM_PROMPT, /绝不能在 message 中直接透露，也不能让别人从措辞中推断出来/);
  assert.match(AI_SYSTEM_PROMPT, /不超过 20 个字符/);
  assert.doesNotMatch(AI_SYSTEM_PROMPT, /安全短句库|commentStyle/);
});

test("the conservative fallback checks when possible and otherwise calls", () => {
  const checkRoom = roomAtBotTurn();
  const botId = checkRoom.currentTurnId;
  assert.equal(conservativeFallback(checkRoom, botId).action, "check");

  checkRoom.currentMaxBet = 20;
  assert.equal(conservativeFallback(checkRoom, botId).action, "call");
});

test("a successful AI turn uses the shared action engine", async () => {
  const room = roomAtBotTurn();
  const provider = { decide: async () => '{"action":"check","raiseAmount":null,"message":"先看看你们怎么打。"}' };

  const outcome = await runBotTurn(room, provider);

  assert.equal(outcome.fallback, false);
  assert.equal(outcome.result.action, "check");
  assert.equal(room.stage, "preflop");
  assert.equal(room.currentTurnId, "human");
});

test("provider failures, empty JSON, and illegal actions fall back without blocking", async () => {
  const providers = [
    { decide: async () => { throw new Error("timeout"); } },
    { decide: async () => "" },
    { decide: async () => '{"action":"dance","message":"?"}' },
  ];

  for (const provider of providers) {
    const room = roomAtBotTurn();
    const outcome = await runBotTurn(room, provider);
    assert.equal(outcome.fallback, true);
    assert.equal(outcome.result.action, "check");
    assert.equal(room.stage, "preflop");
  }
});

test("stale AI responses cannot mutate a newer turn", async () => {
  const room = roomAtBotTurn();
  let resolveDecision;
  const provider = { decide: () => new Promise((resolve) => { resolveDecision = resolve; }) };
  const pending = runBotTurn(room, provider);

  room.turnVersion += 1;
  resolveDecision('{"action":"check","message":"这局节奏真快。"}');
  const outcome = await pending;

  assert.equal(outcome.stale, true);
  assert.equal(room.currentTurnId.startsWith("bot:"), true);
  assert.equal(room.actionHistory.length, 1);
});

test("multiple consecutive bots can complete a betting round", async () => {
  const room = roomAtBotTurn(2);
  const provider = { decide: async () => '{"action":"check","message":"你们继续。"}' };

  const first = await runBotTurn(room, provider);
  assert.equal(first.bot.nickname, "AI 1");
  assert.equal(room.players.find((player) => player.id === room.currentTurnId).nickname, "AI 2");
  const second = await runBotTurn(room, provider);

  assert.equal(second.bot.nickname, "AI 2");
  assert.equal(room.stage, "preflop");
  assert.equal(room.currentTurnId, "human");
});

test("AI context contains only its own hole cards and public state", () => {
  const room = roomAtBotTurn();
  const bot = room.players.find((player) => player.isBot);
  const human = room.players.find((player) => !player.isBot);
  bot.hand = ["A♠", "K♠"];
  human.hand = ["Q♥", "Q♦"];
  room.deck = ["2♣"];

  const serialized = JSON.stringify(buildAiGameState(room, bot.id));
  assert.match(serialized, /A♠/);
  assert.doesNotMatch(serialized, /Q♥|Q♦|2♣/);
});
