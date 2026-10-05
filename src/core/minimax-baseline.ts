// 独立基准：不做任何剪枝、不共享搜索代码路径的朴素 negamax，
// 用于在小深度下核对 alpha-beta 搜索的评分与“全部最优列集合”。

import { Board, COLS, ROWS } from './rules';
import { evaluate } from './evaluate';
import { WIN } from './search';

function plainNegamax(board: Board, depth: number, ply: number): number {
  const st = board.status();
  if (st.winner !== null) return -(WIN - ply);
  if (st.draw) return 0;
  if (depth === 0) return evaluate(board, board.currentPlayer());
  let best = -Infinity;
  for (let col = 0; col < COLS; col++) {
    if (board.heights[col] >= ROWS) continue;
    board.apply(col);
    try {
      const val = -plainNegamax(board, depth - 1, ply + 1);
      if (val > best) best = val;
    } finally {
      board.undo();
    }
  }
  return best;
}

export interface BaselineResult {
  /** 每个合法根列的精确评分（当前行动方视角） */
  columnScores: Array<{ col: number; score: number }>;
  bestScore: number;
  /** 取得最高分的全部列（严格同分集合），按列号升序 */
  bestColumns: number[];
}

/** 枚举全部根候选并精确评分。仅适合小深度使用（无剪枝）。 */
export function baselineRoot(board: Board, depth: number): BaselineResult {
  const terminal = board.status();
  if (terminal.over) {
    return { columnScores: [], bestScore: terminal.draw ? 0 : NaN, bestColumns: [] };
  }
  const columnScores: Array<{ col: number; score: number }> = [];
  for (const col of board.legalColumns()) {
    board.apply(col);
    let score: number;
    try {
      score = -plainNegamax(board, depth - 1, 1);
    } finally {
      board.undo();
    }
    columnScores.push({ col, score });
  }
  const bestScore = columnScores.reduce((m, x) => (x.score > m ? x.score : m), -Infinity);
  const bestColumns = columnScores.filter((x) => x.score === bestScore).map((x) => x.col);
  return { columnScores, bestScore, bestColumns };
}
