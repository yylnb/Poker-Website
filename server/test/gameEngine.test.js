import assert from "node:assert/strict";
import test from "node:test";
import {
  GameError,
  addBot,
  applyPlayerAction,
  computeAndDistributePots,
  createHumanPlayer,
  createRoom,
  createRoomView,
  removeBot,
  selectNextHumanOwner,
  startHand,
} from "../gameEngine.js";

function roomWithHumans(count = 2) {
  const room = createRoom("room-1", "human-1");
  for (let index = 1; index <= count; index += 1) {
    room.players.push(createHumanPlayer(`human-${index}`, `玩家 ${index}`));
  }
  return room;
}

test("only the owner can manage at most three bots outside an active hand", () => {
  const room = roomWithHumans(1);

  assert.throws(() => addBot(room, "stranger"), (error) => error instanceof GameError && error.code === "OWNER_ONLY");
  const bots = [addBot(room, room.ownerId), addBot(room, room.ownerId), addBot(room, room.ownerId)];
  assert.deepEqual(bots.map((bot) => bot.nickname), ["AI 1", "AI 2", "AI 3"]);
  assert.throws(() => addBot(room, room.ownerId), (error) => error.code === "BOT_LIMIT_REACHED");

  room.handInProgress = true;
  assert.throws(() => removeBot(room, room.ownerId, bots[0].id), (error) => error.code === "BOT_MANAGEMENT_LOCKED");
  room.handInProgress = false;
  assert.equal(removeBot(room, room.ownerId, bots[0].id).isBot, true);
  assert.equal(addBot(room, room.ownerId).nickname, "AI 1");
});

test("bots never become room owner", () => {
  const room = roomWithHumans(1);
  addBot(room, room.ownerId);
  room.players = room.players.filter((player) => player.isBot);
  assert.equal(selectNextHumanOwner(room), null);
});

test("a hand requires at least two funded players", () => {
  const room = roomWithHumans(1);
  assert.throws(() => startHand(room, room.ownerId), (error) => error.code === "NOT_ENOUGH_PLAYERS");

  room.players.push(createHumanPlayer("human-2", "玩家 2"));
  assert.doesNotThrow(() => startHand(room, room.ownerId));
  assert.equal(room.handInProgress, true);
  assert.equal(room.pot, 20);
});

test("shared actions advance from ante to preflop and deal private cards", () => {
  const room = roomWithHumans(2);
  startHand(room, room.ownerId);

  applyPlayerAction(room, "human-1", { action: "check" });
  const result = applyPlayerAction(room, "human-2", { action: "check" });

  assert.equal(result.roundEnded, true);
  assert.equal(result.stageChanged, true);
  assert.equal(room.stage, "preflop");
  assert.equal(room.currentTurnId, "human-1");
  assert.ok(room.players.every((player) => player.hand.length === 2));
});

test("a complete checked-down hand reaches showdown and preserves total chips", () => {
  const room = roomWithHumans(2);
  startHand(room, room.ownerId);
  let actions = 0;

  while (room.handInProgress) {
    applyPlayerAction(room, room.currentTurnId, { action: "check" });
    actions += 1;
    assert.ok(actions <= 10, "the hand should finish after five two-player betting rounds");
  }

  assert.equal(actions, 10);
  assert.equal(room.stage, "showdown");
  assert.equal(room.communityCards.length, 5);
  assert.equal(room.players.reduce((sum, player) => sum + player.chips, 0), 6000);
});

test("early fold reports and awards the original pot amount", () => {
  const room = roomWithHumans(2);
  startHand(room, room.ownerId);

  const result = applyPlayerAction(room, "human-1", { action: "fold" });

  assert.equal(result.showdown[0].amount, 20);
  assert.equal(result.showdown[0].winners[0].share, 20);
  assert.equal(room.players.find((player) => player.id === "human-2").chips, 3010);
  assert.equal(room.pot, 0);
  assert.equal(room.handInProgress, false);
  assert.equal(room.stage, "showdown");
});

test("room views hide the deck, internal state, and other private hands", () => {
  const room = roomWithHumans(2);
  room.deck = ["A♠", "K♠"];
  room.actionHistory = [{ action: "check" }];
  room.players[0].hand = ["A♥", "A♦"];
  room.players[1].hand = ["K♥", "K♦"];
  room.stage = "preflop";

  const firstView = createRoomView(room, "human-1");
  assert.deepEqual(firstView.players[0].hand, ["A♥", "A♦"]);
  assert.deepEqual(firstView.players[1].hand, [null, null]);
  assert.equal("deck" in firstView, false);
  assert.equal("actionHistory" in firstView, false);
  assert.equal("turnVersion" in firstView, false);

  room.stage = "showdown";
  const showdownView = createRoomView(room, "human-1");
  assert.deepEqual(showdownView.players[1].hand, ["K♥", "K♦"]);
});

test("showdown distributes a main pot and side pot to eligible winners", () => {
  const room = roomWithHumans(3);
  room.communityCards = ["2♣", "3♣", "4♦", "5♥", "9♠"];
  room.players[0].hand = ["A♠", "A♥"];
  room.players[1].hand = ["K♠", "K♥"];
  room.players[2].hand = ["Q♠", "Q♥"];
  room.players[0].totalContribution = 100;
  room.players[1].totalContribution = 200;
  room.players[2].totalContribution = 200;
  room.pot = 500;

  const pots = computeAndDistributePots(room);

  assert.deepEqual(pots.map((pot) => pot.amount), [300, 200]);
  assert.equal(pots[0].winners[0].id, "human-1");
  assert.equal(pots[1].winners[0].id, "human-2");
  assert.equal(room.pot, 0);
});
