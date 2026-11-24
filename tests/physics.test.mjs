import assert from "node:assert/strict";
import test from "node:test";
import { serverGame } from "../dist/server/index.js";
import { simulateRink } from "../dist/server/physics.js";

const context = {
  language: "en",
  now: 10_000,
  players: ["left", "right"].map(id => ({ id, name: id, color: "#fff" }))
};

function rink(puck, paddles = {}) {
  const state = serverGame.createInitialState(context);
  for (const side of ["left", "right"]) Object.assign(state.paddles[side], paddles[side]);
  return { ...state, phase: "playing", ...puck };
}

test("paddle movement transfers momentum even when the puck starts at rest", () => {
  const state = rink({ puckX: 401 }, { left: { x: 300, inputX: 1 } });
  const after = simulateRink(state, 0.16);
  assert.ok(after.puckVx > 800);
  assert.ok(after.puckX > 470);
  assert.equal(after.puckVy, 0);
  assert.equal(state.paddles.left.x, 300);
});

test("held input against a boundary does not add force to a bank shot", () => {
  const puck = { puckX: 556, puckY: 260, puckVy: 900 };
  const blocked = rink(puck, { left: { x: 558, inputX: 1 } });
  const neutral = rink(puck, { left: { x: 558 } });
  assert.deepEqual(
    [simulateRink(blocked, 0.09).puckVx, simulateRink(blocked, 0.09).puckVy],
    [simulateRink(neutral, 0.09).puckVx, simulateRink(neutral, 0.09).puckVy]
  );
});

test("fast pucks bounce at the rail and glance off the goalpost", () => {
  const rail = simulateRink(rink({ puckX: 105, puckY: 91, puckVx: -1400 }), 0.15);
  assert.equal(rail.goal, null);
  assert.ok(rail.puckVx > 0 && rail.puckVx < 1400);
  const post = simulateRink(rink({ puckX: 105, puckY: 198, puckVx: -1400 }), 0.15);
  assert.equal(post.goal, null);
  assert.ok(post.puckVx > 0 && post.puckVy > 0);
});

test("a puck pinned against a solid end rail stays on the table", () => {
  const state = rink({ puckX: 53, puckY: 87, puckVx: -670 },
    { left: { x: 132, y: 87, inputX: -1, vx: -660 } });
  const after = simulateRink(state, 0.25);
  assert.equal(after.goal, null);
  assert.ok(after.puckX >= state.puckRadius);
});

test("the whole puck must enter the goal before a point counts", () => {
  const state = rink({ puckX: 12, puckVx: -1000 });
  const partial = serverGame.tick(state, 24, context);
  assert.ok(partial.puckX < 0);
  assert.equal(partial.scoresByPlayer.right, 0);
  const scored = serverGame.tick(partial, 24, context);
  assert.equal(scored.scoresByPlayer.right, 1);
  assert.equal(scored.puckX, scored.arenaWidth / 2);
  assert.ok(scored.serveCountdownEndsAt > context.now);
});

test("the fifth goal ends the round and awards exactly one platform point", () => {
  const state = rink({ puckX: 12, puckVx: -1000, scoresByPlayer: { left: 0, right: 4 } });
  const result = serverGame.tick(state, 60, context);
  assert.equal(result.phase, "locked");
  assert.equal(result.scoresByPlayer.right, 5);
  assert.equal(result.winnerPlayerId, "right");
  assert.deepEqual(serverGame.buildScore(result, context).map(({ playerId, delta }) => [playerId, delta]), [["right", 1]]);
});

test("a stalled puck triggers a new face-off without adding a point", () => {
  const state = rink({ puckX: 163, puckY: 183, puckIdleMs: 3_984 });
  const next = serverGame.tick(state, 16, context);
  assert.equal(next.puckX, 600);
  assert.equal(next.puckIdleMs, 0);
  assert.equal(next.serveDirection, "left");
  assert.equal(next.serveCountdownEndsAt, context.now + 3_000);
  assert.deepEqual(next.scoresByPlayer, state.scoresByPlayer);
});
