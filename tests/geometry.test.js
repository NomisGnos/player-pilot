import test from "node:test";
import assert from "node:assert/strict";

import { sortTokensByDistance, tokenFootprintDistanceFeet } from "../scripts/geometry.js";

const grid = { gridSize: 100, gridDistance: 5 };

test("measures adjacent tokens from their occupied spaces", () => {
  const source = { x: 0, y: 0, width: 1, height: 1 };
  const target = { x: 100, y: 0, width: 3, height: 3 };
  assert.equal(tokenFootprintDistanceFeet(source, target, grid), 5);
  assert.equal(tokenFootprintDistanceFeet(target, source, grid), 5);
});

test("does not charge for the unused center squares of a large target", () => {
  const source = { x: 0, y: 0, width: 1, height: 1 };
  const target = { x: 200, y: 0, width: 3, height: 3 };
  assert.equal(tokenFootprintDistanceFeet(source, target, grid), 10);
});

test("uses the nearest occupied squares on both axes", () => {
  const source = { x: 0, y: 0, width: 1, height: 1 };
  const target = { x: 200, y: 200, width: 3, height: 3 };
  const distance = tokenFootprintDistanceFeet(source, target, grid);
  assert.equal(Math.floor(distance / 5) * 5, 10);
});

test("handles distance beyond a large token without center undercounting or overcounting", () => {
  const source = { x: 0, y: 0, width: 1, height: 1 };
  const target = { x: 400, y: 0, width: 3, height: 3 };
  assert.equal(tokenFootprintDistanceFeet(source, target, grid), 20);
});

test("sorts target tokens nearest-first without mutating the source list", () => {
  const source = { x: 0, y: 0, width: 1, height: 1 };
  const far = { id: "far", x: 500, y: 0, width: 1, height: 1 };
  const near = { id: "near", x: 100, y: 0, width: 1, height: 1 };
  const middle = { id: "middle", x: 300, y: 0, width: 1, height: 1 };
  const tokens = [far, near, middle];

  assert.deepEqual(sortTokensByDistance(tokens, source, grid).map((token) => token.id), ["near", "middle", "far"]);
  assert.deepEqual(tokens.map((token) => token.id), ["far", "near", "middle"]);
});

test("keeps equally distant targets in their existing order", () => {
  const source = { x: 0, y: 0, width: 1, height: 1 };
  const first = { id: "first", x: 100, y: 0, width: 1, height: 1 };
  const second = { id: "second", x: 0, y: 100, width: 1, height: 1 };

  assert.deepEqual(sortTokensByDistance([first, second], source, grid).map((token) => token.id), ["first", "second"]);
});
