import test from "node:test";
import assert from "node:assert/strict";

import { tokenFootprintDistanceFeet } from "../scripts/geometry.js";

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
