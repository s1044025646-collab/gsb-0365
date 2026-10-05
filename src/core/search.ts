// 自行实现的 negamax + alpha-beta 剪枝有限深度搜索。
// 评分一律以“当前节点行动方”的视角给出（negamax 约定）：
//   胜 = +(WIN - 终局已走步数)，负 = -(WIN - 终局已走步数)，平局 = 0。
// 深度截断时使用 evaluate.ts 的公开棋型启发式，其绝对值远小于 WIN。

import { Board, COLS } from './rules';
import { evaluate } from './evaluate';

export const MIN_DEPTH = 1;
export const MAX_DEPTH = 6;
export const MIN_BUDGET = 1;
export const MAX_BUDGET = 2_000_000;
export const WIN = 1_000_000;

export class BudgetExhausted extends Error {
  constructor() {
    super('节点预算已耗尽，搜索未完成');
    this.code = 'BUDGET_EXHAUSTED';
  }
  code: string;
}

export interface SearchStats {
  nodes: number;
  cutoffs: number;
}

export interface SearchResult {
  /** false 表示预算耗尽，bestMove/score 不得作为该深度的最终最优结论 */
  complete: boolean;
  bestMove: number | null;
  score: number | null;
  depth: number;
  /** 主变化：列编号序列，每一步都可在真实规则下执行，遇终局停止 */
  principalVariation: number[];
  nodes: number;
  cutoffs: number;
  budget: number;
  /** 根候选在预算耗尽前已完成的列（用于解释“没搜完全部列”） */
  completedRootColumns: number[];
}

class Searcher {
  nodes = 0;
  cutoffs = 0;
  constructor(private budget: number) {}

  private tick() {
    this.nodes += 1;
    if (this.nodes > this.budget) throw new BudgetExhausted();
  }

  /**
   * @returns 以当前行动方视角的评分；outPv 收集主变化
   */
  negamax(board: Board, depth: number, alpha: number, beta: number, ply: number, outPv: number[]): number {
    this.tick();
    const st = board.status();
    if (st.winner !== null) {
      // 上一步对手已获胜：当前行动方失败，终局分压过一切启发式。
      outPv.length = 0;
      return -(WIN - ply);
    }
    if (st.draw) {
      outPv.length = 0;
      return 0;
    }
    if (depth === 0) {
      outPv.length = 0;
      return evaluate(board, board.currentPlayer());
    }

    let best = -Infinity;
    let bestPv: number[] = [];
    // 固定按列号从小到大；严格大于才更新，保证同分选择最小列号。
    for (let col = 0; col < COLS; col++) {
      if (board.heights[col] >= board.grid.length) continue;
      board.apply(col);
      const childPv: number[] = [];
      try {
        const val = -this.negamax(board, depth - 1, -beta, -alpha, ply + 1, childPv);
        if (val > best) {
          best = val;
          bestPv = [col, ...childPv];
        }
        if (val > alpha) alpha = val;
        if (alpha >= beta) {
          this.cutoffs += 1;
          break;
        }
      } finally {
        board.undo();
      }
    }
    outPv.length = 0;
    outPv.push(...bestPv);
    return best;
  }
}

/** 根搜索：预算耗尽时报告未完成，绝不把部分列的最好分标记为最终最优。 */
export function searchRoot(board: Board, depth: number, budget: number): SearchResult {
  if (!Number.isInteger(depth) || depth < MIN_DEPTH || depth > MAX_DEPTH) {
    throw Object.assign(new Error(`深度必须是 ${MIN_DEPTH}..${MAX_DEPTH} 的整数`), {
      code: 'INVALID_DEPTH',
    });
  }
  if (!Number.isInteger(budget) || budget < MIN_BUDGET || budget > MAX_BUDGET) {
    throw Object.assign(new Error(`节点预算必须是 ${MIN_BUDGET}..${MAX_BUDGET} 的整数`), {
      code: 'INVALID_BUDGET',
    });
  }
  const terminal = board.status();
  if (terminal.over) {
    return {
      complete: true,
      bestMove: null,
      // 终局输入：平局 0；否则按胜方相对“当前行动方”记符号（仅报告，不建议落子）。
      score: terminal.draw
        ? 0
        : terminal.winner === board.currentPlayer()
          ? WIN
          : -WIN,
      depth,
      principalVariation: [],
      nodes: 0,
      cutoffs: 0,
      budget,
      completedRootColumns: [],
    };
  }

  const searcher = new Searcher(budget);
  let alpha = -Infinity;
  const beta = Infinity;
  let best = -Infinity;
  let bestPv: number[] = [];
  let bestCol: number | null = null;
  const completed: number[] = [];

  try {
    for (const col of board.legalColumns()) {
      board.apply(col);
      const childPv: number[] = [];
      try {
        const val = -searcher.negamax(board, depth - 1, -beta, -alpha, 1, childPv);
        if (val > best) {
          best = val;
          bestCol = col;
          bestPv = [col, ...childPv];
        }
        if (val > alpha) alpha = val;
      } finally {
        board.undo();
      }
      completed.push(col);
    }
  } catch (err) {
    if (!(err instanceof BudgetExhausted)) throw err;
    return {
      complete: false,
      bestMove: null,
      score: null,
      depth,
      principalVariation: [],
      nodes: searcher.nodes,
      cutoffs: searcher.cutoffs,
      budget,
      completedRootColumns: completed,
    };
  }

  return {
    complete: true,
    bestMove: bestCol,
    score: best,
    depth,
    principalVariation: bestPv,
    nodes: searcher.nodes,
    cutoffs: searcher.cutoffs,
    budget,
    completedRootColumns: completed,
  };
}

/** 校验主变化：在同一局面副本上逐步执行，遇终局停止；返回实际可执行步数。 */
export function verifyPrincipalVariation(board: Board, pv: number[]): {
  executable: number[];
  stopsAtTerminal: boolean;
} {
  const b = board.clone();
  const executable: number[] = [];
  for (const col of pv) {
    if (b.status().over) break;
    b.apply(col);
    executable.push(col);
  }
  return { executable, stopsAtTerminal: b.status().over };
}
