import { test } from "node:test";
import assert from "node:assert/strict";
import { Board, GameError } from "../rules";

test("满列拒绝落子", () => {
  // 同一列交替落子（X/O 相间，无人四连），六子后列满
  const b = Board.fromMoves([0, 0, 0, 0, 0, 0]);
  assert.equal(b.heights[0], 6);
  assert.throws(() => b.play(0), (e: GameError) => e.code === "COLUMN_FULL");
});

test("越界列拒绝落子", () => {
  const b = new Board();
  assert.throws(() => b.play(7), (e: GameError) => e.code === "COLUMN_OUT_OF_RANGE");
  assert.throws(() => b.play(-1), (e: GameError) => e.code === "COLUMN_OUT_OF_RANGE");
});

test("斜线胜利被识别", () => {
  // X 构造 / 斜线：(0,0)(1,1)(2,2)(3,3)
  const b = Board.fromMoves([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
  assert.equal(b.status.kind, "win");
  if (b.status.kind === "win") assert.equal(b.status.winner, 1);
});

test("终局后拒绝继续落子", () => {
  const b = Board.fromMoves([0, 1, 0, 1, 0, 1, 0]);
  assert.equal(b.status.kind, "win");
  assert.throws(() => b.play(2), (e: GameError) => e.code === "GAME_ALREADY_OVER");
  assert.throws(() => Board.fromMoves([0, 1, 0, 1, 0, 1, 0, 2]), (e: GameError) => e.code === "GAME_ALREADY_OVER");
});

test("落子撤销完全恢复棋盘与列高", () => {
  const b = Board.fromMoves([3, 3, 4]);
  const snapshot = b.toString();
  const heights = [...b.heights];
  for (const c of b.legalColumns()) {
    b.play(c);
    b.undo(c);
    assert.equal(b.toString(), snapshot);
    assert.deepEqual(b.heights, heights);
    assert.equal(b.moveCount, 3);
    assert.equal(b.status.kind, "ongoing");
  }
});

test("撤销也恢复终局状态", () => {
  const b = Board.fromMoves([0, 1, 0, 1, 0, 1]);
  b.play(0);
  assert.equal(b.status.kind, "win");
  b.undo(0);
  assert.equal(b.status.kind, "ongoing");
  assert.equal(b.grid[0][3], 0);
  assert.equal(b.heights[0], 3);
});

test("非法序列整体失败且棋盘不变", () => {
  assert.throws(() => Board.fromMoves([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]));
  const b = new Board();
  assert.throws(() => b.play(9));
  assert.equal(b.moveCount, 0);
});
