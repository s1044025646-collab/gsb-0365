// 搜索模块：带 alpha-beta 剪枝的 negamax，深度 1-6，节点预算可配。
// 同分处理确定：列按 0..6 升序枚举，仅在严格更优时替换，
// 因此同分取编号最小的列。相同局面与配置必得相同结果。

import { Board } from "./rules";
import { evaluate, WIN_SCORE } from "./evaluate";

export const MIN_DEPTH = 1;
export const MAX_DEPTH = 6;
export const DEFAULT_NODE_BUDGET = 200_000;
export const MAX_NODE_BUDGET = 2_000_000;

export class BudgetExhausted extends Error {
  constructor() {
    super("节点预算耗尽");
    this.name = "BudgetExhausted";
  }
}

export interface SearchStats {
  nodes: number;
  prunes: number;
}

interface NegamaxResult {
  score: number;
  pv: number[];
}

function negamax(
  board: Board,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  stats: SearchStats,
  budget: number
): NegamaxResult {
  if (stats.nodes >= budget) throw new BudgetExhausted();
  stats.nodes++;

  const status = board.status;
  if (status.kind === "win") {
    // 上一步对手获胜，当前方视角为负；剩余深度越多（输得越快）惩罚越重，
    // 等价于偏好更快获胜。终局分压过一切启发式分。
    return { score: -(WIN_SCORE + depth), pv: [] };
  }
  if (status.kind === "draw") return { score: 0, pv: [] };
  if (depth === 0) return { score: evaluate(board, board.sideToMove()), pv: [] };

  let best: NegamaxResult = { score: -Infinity, pv: [] };
  for (const col of board.legalColumns()) {
    board.play(col);
    const child = negamax(board, depth - 1, ply + 1, -beta, -alpha, stats, budget);
    board.undo(col);
    const score = -child.score;
    if (score > best.score) {
      best = { score, pv: [col, ...child.pv] };
    }
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      stats.prunes++;
      break; // beta 截断：剩余列不影响本层结果
    }
  }
  return best;
}

export interface AnalysisResult {
  completed: boolean;
  bestColumn: number | null;
  score: number | null;
  depth: number;
  pv: number[];
  nodes: number;
  prunes: number;
  nodeBudget: number;
  terminal?: { kind: "win" | "draw"; winner?: 1 | 2 };
}

/** 分析给定局面。已终局时只报告终局，不建议落子。 */
export function analyze(board: Board, depth: number, nodeBudget: number): AnalysisResult {
  if (!Number.isInteger(depth) || depth < MIN_DEPTH || depth > MAX_DEPTH) {
    throw new Error(`深度必须是 ${MIN_DEPTH}-${MAX_DEPTH} 的整数`);
  }
  if (!Number.isInteger(nodeBudget) || nodeBudget < 1 || nodeBudget > MAX_NODE_BUDGET) {
    throw new Error(`节点预算必须是 1-${MAX_NODE_BUDGET} 的整数`);
  }
  const stats: SearchStats = { nodes: 0, prunes: 0 };
  const status = board.status;
  if (status.kind === "win") {
    return { completed: true, bestColumn: null, score: null, depth, pv: [], nodes: 0, prunes: 0, nodeBudget, terminal: { kind: "win", winner: status.winner } };
  }
  if (status.kind === "draw") {
    return { completed: true, bestColumn: null, score: null, depth, pv: [], nodes: 0, prunes: 0, nodeBudget, terminal: { kind: "draw" } };
  }
  try {
    const root = negamax(board.clone(), depth, 0, -Infinity, Infinity, stats, nodeBudget);
    return {
      completed: true,
      bestColumn: root.pv[0],
      score: root.score,
      depth,
      pv: root.pv,
      nodes: stats.nodes,
      prunes: stats.prunes,
      nodeBudget,
    };
  } catch (e) {
    if (e instanceof BudgetExhausted) {
      // 预算耗尽：结果不完整，绝不把部分探索的分数标为该深度最终最优。
      return { completed: false, bestColumn: null, score: null, depth, pv: [], nodes: stats.nodes, prunes: stats.prunes, nodeBudget };
    }
    throw e;
  }
}

/**
 * 独立基准：不剪枝的纯 minimax（negamax 形式），用于测试核对。
 * 返回每个根候选列的精确分值（同分集合由调用方比较）。
 */
export function benchmarkMinimax(board: Board, depth: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const col of board.legalColumns()) {
    board.play(col);
    out.set(col, -plain(board, depth - 1));
    board.undo(col);
  }
  return out;

  function plain(b: Board, d: number): number {
    const s = b.status;
    if (s.kind === "win") return -(WIN_SCORE + d);
    if (s.kind === "draw") return 0;
    if (d === 0) return evaluate(b, b.sideToMove());
    let best = -Infinity;
    for (const c of b.legalColumns()) {
      b.play(c);
      const v = -plain(b, d - 1);
      b.undo(c);
      if (v > best) best = v;
    }
    return best;
  }
}

/** 校验主变化：逐步在真实规则下执行，返回执行步数与终局信息 */
export function verifyPv(board: Board, pv: number[]): { applied: number[]; terminal: string | null } {
  const b = board.clone();
  const applied: number[] = [];
  for (const col of pv) {
    if (b.isOver()) break;
    b.play(col); // 非法列会抛 GameError
    applied.push(col);
  }
  const s = b.status;
  return {
    applied,
    terminal: s.kind === "win" ? `win:${s.winner}` : s.kind === "draw" ? "draw" : null,
  };
}
