import { test } from "node:test";
import assert from "node:assert/strict";
import { Board } from "../rules";
import { evaluate } from "../evaluate";
import { analyze, benchmarkMinimax, verifyPv } from "../search";
import { WIN_SCORE } from "../evaluate";

function mirror(moves: number[]): number[] {
  return moves.map((c) => 6 - c);
}

test("演示1：0 1 0 1 0 2 后当前方在列 0 立即获胜", () => {
  const b = Board.fromMoves([0, 1, 0, 1, 0, 2]);
  assert.equal(b.sideToMove(), 1); // 六步后轮到先手 X
  const r = analyze(b, 1, 10000);
  assert.equal(r.completed, true);
  assert.equal(r.bestColumn, 0);
  assert.ok(r.score! >= WIN_SCORE, "立即获胜应给出终局级分数");
  const check = verifyPv(b, r.pv);
  assert.equal(check.terminal, "win:1");
});

test("演示2：0 1 0 1 2 1 后识别对手在列 1 的威胁", () => {
  // O 在列 1 已有三子（行 0,1,2），X 必须堵列 1，否则 O 下一步胜
  const b = Board.fromMoves([0, 1, 0, 1, 2, 1]);
  const r = analyze(b, 2, 100000);
  assert.equal(r.completed, true);
  assert.equal(r.bestColumn, 1);
});

test("镜像局面评分对应", () => {
  const moves = [0, 1, 0, 1, 2, 1, 4];
  const b1 = Board.fromMoves(moves);
  const b2 = Board.fromMoves(mirror(moves));
  assert.equal(evaluate(b1, b1.sideToMove()), evaluate(b2, b2.sideToMove()));
  const r1 = analyze(b1, 3, 100000);
  const r2 = analyze(b2, 3, 100000);
  assert.equal(r1.score, r2.score);
  assert.equal(r1.bestColumn, 6 - r2.bestColumn!);
});

test("深度一与深度二结果不同（更深搜索发现威胁）", () => {
  // 局面 [0,1,1,2,2,3]：深度1启发式选择列3，深度2看到对手应对后改选列4
  const b = Board.fromMoves([0, 1, 1, 2, 2, 3]);
  const d1 = analyze(b, 1, 100000);
  const d2 = analyze(b, 2, 100000);
  assert.equal(d1.bestColumn, 3);
  assert.equal(d2.bestColumn, 4);
});

test("与无剪枝 minimax 基准核对评分与最优候选集合", () => {
  const positions = [
    [3],
    [0, 1, 0, 1, 2, 1],
    [3, 3, 2, 4, 4],
    [0, 6, 3, 3, 1],
  ];
  for (const moves of positions) {
    for (const depth of [1, 2, 3]) {
      const b = Board.fromMoves(moves);
      const bench = benchmarkMinimax(b, depth);
      const bestScore = Math.max(...bench.values());
      const bestSet = new Set([...bench.entries()].filter(([, v]) => v === bestScore).map(([k]) => k));
      const r = analyze(b, depth, 500000);
      assert.equal(r.completed, true);
      assert.equal(r.score, bestScore, `局面 ${moves} 深度 ${depth} 分数应与基准一致`);
      assert.ok(bestSet.has(r.bestColumn!), `最优列应在基准同分集合内`);
      // 同分按列升序取最小
      assert.equal(r.bestColumn, Math.min(...bestSet));
    }
  }
});

test("同分确定性：相同局面与配置得到相同结果", () => {
  const b = Board.fromMoves([3, 2, 3]);
  const r1 = analyze(b, 3, 100000);
  const r2 = analyze(Board.fromMoves([3, 2, 3]), 3, 100000);
  assert.deepEqual(r1, r2);
});

test("预算不足时报告未完成，不给出最优列与分数", () => {
  const b = Board.fromMoves([3, 3, 2]);
  const r = analyze(b, 6, 5);
  assert.equal(r.completed, false);
  assert.equal(r.bestColumn, null);
  assert.equal(r.score, null);
  assert.ok(r.nodes <= 5);
});

test("终局局面只报告终局，不建议落子", () => {
  const b = Board.fromMoves([0, 1, 0, 1, 0, 1, 0]);
  const r = analyze(b, 4, 100000);
  assert.equal(r.terminal?.kind, "win");
  assert.equal(r.bestColumn, null);
  assert.equal(r.pv.length, 0);
});

test("主变化每步都合法且遇终局停止", () => {
  const b = Board.fromMoves([0, 1, 0, 1, 0, 2]);
  const r = analyze(b, 4, 200000);
  const check = verifyPv(b, r.pv);
  assert.deepEqual(check.applied, r.pv.slice(0, check.applied.length));
  assert.equal(check.terminal, "win:1");
});

test("终局分压过启发式分且偏好更快获胜", () => {
  const b = Board.fromMoves([0, 1, 0, 1, 0, 2]);
  const r = analyze(b, 3, 100000);
  // 深度 3 时一步获胜：剩余深度 2 计入分数，体现“更快获胜得分更高”
  assert.equal(r.score, WIN_SCORE + 2);
  assert.ok(r.score! > WIN_SCORE, "终局分压过一切启发式分");
});
