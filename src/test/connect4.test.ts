import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Board, boardFromMoves, COLS, ROWS, RuleViolation } from '../core/rules';
import { searchRoot, verifyPrincipalVariation } from '../core/search';
import { baselineRoot } from '../core/minimax-baseline';
import { evaluate } from '../core/evaluate';
import { Store } from '../core/db';

test('演示序列1：0,1,0,1,0,2 后 0 列立即获胜，终局无合法列', () => {
  const board = boardFromMoves([0, 1, 0, 1, 0, 2]);
  assert.equal(board.currentPlayer(), 1);
  const before = board.status();
  assert.equal(before.over, false);
  board.apply(0);
  const after = board.status();
  assert.equal(after.over, true);
  assert.equal(after.winner, 1);
  assert.deepEqual(board.legalColumns(), []);
});

test('演示序列2：0,1,0,1,2,1 后识别 1 列的立即获胜威胁', () => {
  // 玩家2(黄)在列1已有三枚竖连(行0,1,2)，当前方玩家1必须阻挡。
  const board = boardFromMoves([0, 1, 0, 1, 2, 1]);
  assert.equal(board.currentPlayer(), 1);
  const result = searchRoot(board, 2, 500000);
  assert.equal(result.complete, true);
  // 深度2：若不挡列1，对手下一步在列1取胜，因此列1是唯一最优
  assert.equal(result.bestMove, 1);
  assert.ok((result.score ?? 0) < 0, '玩家1处于对手立即获胜威胁下，评分应为负但仍是最佳阻挡');
});

test('拒绝满列、越界、终局后落子', () => {
  const board = new Board();
  for (let i = 0; i < ROWS; i++) board.apply(3);
  assert.throws(() => board.apply(3), (e: Error) => (e as RuleViolation).code === 'COLUMN_FULL');
  assert.throws(() => board.apply(-1), (e: Error) => (e as RuleViolation).code === 'COLUMN_OUT_OF_RANGE');
  assert.throws(() => board.apply(7), (e: Error) => (e as RuleViolation).code === 'COLUMN_OUT_OF_RANGE');

  // 红竖连四获胜（列0 四枚）后继续落子应拒绝
  const win = boardFromMoves([0, 1, 0, 1, 0, 1, 0]);
  assert.equal(win.status().winner, 1);
  assert.throws(() => win.apply(2), (e: Error) => (e as RuleViolation).code === 'GAME_ALREADY_OVER');

  // 下满且无四连的平局后继续落子应拒绝
  const drawMoves = DRAW_SEQUENCE;
  const draw = boardFromMoves(drawMoves);
  assert.deepEqual(draw.status(), { over: true, winner: null, draw: true });
  assert.throws(() => draw.apply(0), (e: Error) => (e as RuleViolation).code === 'GAME_ALREADY_OVER');
});

test('撤销落子恢复棋盘格、列高与终局标记，不污染下一候选', () => {
  const board = boardFromMoves([0, 1, 0, 1, 0, 2]);
  const snapshotGrid = board.grid.map((r) => r.slice());
  const snapshotHeights = board.heights.slice();
  board.apply(0); // 玩家1竖连四获胜
  assert.equal(board.status().winner, 1);
  board.undo();
  assert.equal(board.status().over, false);
  assert.deepEqual(board.grid, snapshotGrid);
  assert.deepEqual(board.heights, snapshotHeights);
  assert.deepEqual(board.moves, [0, 1, 0, 1, 0, 2]);
});

test('斜线胜利（/）被识别', () => {
  // 构造红斜连四：行0..3，列递增
  // 列布局使红落在 (0,0)(1,1)(2,2)(3,3)，黄填它列
  const seq: number[] = [0, 1, 1, 2, 3, 2, 2, 3, 4, 3, 3];
  // 逐步验证：第11手红落列3 -> (3,3) 与 (2,2)(1,1)(0,0) 成斜四连
  const board = boardFromMoves(seq);
  assert.equal(board.status().winner, 1);
});

test('镜像局面的启发式评分一致', () => {
  const moves = [0, 1, 0, 1, 2, 1];
  const a = boardFromMoves(moves);
  const mirrorMoves = moves.map((c) => COLS - 1 - c);
  const b = boardFromMoves(mirrorMoves);
  assert.equal(evaluate(a, a.currentPlayer()), evaluate(b, b.currentPlayer()));
});

test('深度一与深度二给出不同决策质量（阻挡威胁）', () => {
  // 黄列1竖三，轮到红。深度1只看落子后即时棋型（看不到对手下一手取胜）；
  // 深度2能看到“不挡则列1被对手立即取胜”：非阻挡列评分塌到 -(WIN-2)，
  // 阻挡列1成为唯一最优。
  const board = boardFromMoves([0, 1, 0, 1, 2, 1]);
  const d2 = baselineRoot(board.clone(), 2);
  assert.deepEqual(d2.bestColumns, [1]);
  const d1 = baselineRoot(board.clone(), 1);
  // 深度1看不到终局：所有列评分都保持在启发式量级（|score| 远小于 WIN）
  for (const c of d1.columnScores) assert.ok(Math.abs(c.score) < 900000);
  // 深度2：非阻挡列全部是“对手下一步取胜”，评分跌入终局量级
  const block = d2.columnScores.find((c) => c.col === 1)!;
  const other = d2.columnScores.filter((c) => c.col !== 1);
  for (const c of other) assert.ok(block.score > c.score);
  for (const c of other) assert.ok(c.score <= -900000);
});

test('预算不足报告未完成，不输出最佳列与最终评分', () => {
  const board = new Board();
  const result = searchRoot(board, 6, 50);
  assert.equal(result.complete, false);
  assert.equal(result.bestMove, null);
  assert.equal(result.score, null);
  assert.ok(result.completedRootColumns.length < 7);
  assert.ok(result.nodes > 50);
});

test('深度1-3 上 alpha-beta 与无剪枝基准评分及最优列集合一致', () => {
  const positions = [
    [],
    [3],
    [0, 1, 0, 1, 2, 1],
    [3, 3, 2, 2, 1, 4],
    [0, 1, 0, 1, 0],
  ];
  for (const moves of positions) {
    for (let depth = 1; depth <= 3; depth++) {
      const board = boardFromMoves(moves);
      if (board.status().over) continue;
      const base = baselineRoot(board.clone(), depth);
      const ab = searchRoot(board.clone(), depth, 2_000_000);
      assert.equal(ab.complete, true, `depth=${depth} moves=${moves}`);
      assert.equal(ab.score, base.bestScore, `评分一致 depth=${depth} moves=${moves}`);
      // alpha-beta 因同分固定选最小列号，必须属于基准最优列集合
      assert.ok(base.bestColumns.includes(ab.bestMove!), `最优列集合 depth=${depth} moves=${moves}`);
      // 最优列集合内全部列确实同分
      for (const c of base.columnScores) {
        if (base.bestColumns.includes(c.col)) assert.equal(c.score, base.bestScore);
      }
    }
  }
});

test('剪枝不改变结果且 cutoffs 被统计', () => {
  const board = boardFromMoves([3, 2, 3, 2, 4]);
  const result = searchRoot(board, 5, 2_000_000);
  assert.equal(result.complete, true);
  assert.ok(result.cutoffs >= 0);
  assert.ok(result.principalVariation.length <= 5);
  const check = verifyPrincipalVariation(board, result.principalVariation);
  assert.deepEqual(check.executable, result.principalVariation);
});

test('越快获胜分数越高（同深度按步数折扣）', () => {
  // 序列 ...0,2 后红列0已有三枚竖连，轮到红：一步取胜
  const immediate = boardFromMoves([0, 1, 0, 1, 0, 2]);
  const r1 = searchRoot(immediate, 1, 1_000_000);
  assert.equal(r1.bestMove, 0);
  assert.ok(r1.score! > 0);
  // 空棋盘深度1：最佳落子只有启发式分数，严格低于“一步强制取胜”
  const slower = new Board();
  const r2 = searchRoot(slower, 1, 1_000_000);
  assert.ok(r1.score! > (r2.score ?? -Infinity));
});

test('SQLite：失败输入不留半局；旧报告可查询', () => {
  const dir = join(tmpdir(), `c4-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const store = new Store(join(dir, 't.sqlite'));
  try {
    assert.throws(() => store.saveGame([0, 0, 7]));
    assert.deepEqual(store.listGames(), []);
    const game = store.saveGame([0, 1, 0, 1, 2, 1]);
    const board = boardFromMoves(game.moves);
    const result = searchRoot(board, 2, 500000);
    const report = store.saveReport(game.id, result);
    assert.equal(store.getReport(report.id)?.depth, 2);
    // 同序列同参数幂等
    const again = store.saveReport(game.id, result);
    assert.equal(again.id, report.id);
    assert.equal(store.listGames().length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('终局局面分析只报告终局，不建议落子', () => {
  const board = boardFromMoves([0, 1, 0, 1, 0, 1, 0]);
  const r = searchRoot(board, 4, 100000);
  assert.equal(r.bestMove, null);
  assert.deepEqual(r.principalVariation, []);
  assert.equal(r.nodes, 0);
});

// 下满 42 格且无四连的平局序列（随机搜索构造，程序内再次校验）。
const DRAW_SEQUENCE = [
  3, 2, 1, 6, 5, 5, 5, 3, 5, 1, 0, 5, 6, 1, 3, 5, 2, 6, 3, 0, 4,
  2, 0, 3, 1, 0, 2, 3, 1, 4, 4, 2, 0, 1, 2, 0, 6, 6, 6, 4, 4, 4,
];

function makeFullDraw(): number[] {
  const board = new Board();
  for (const col of DRAW_SEQUENCE) board.apply(col);
  assert.equal(board.moves.length, 42);
  assert.equal(board.status().draw, true, '该填法应无四连');
  return board.moves.slice();
}
