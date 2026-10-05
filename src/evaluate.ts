// 公开启发式评分：从“当前行动方”视角评估非终局局面。
//
// 观察内容（全部来自棋盘本身，无任何外部数据）：
// 1. 所有长度为 4 的窗口（水平、竖直、两种斜线，共 69 个）：
//    - 我方 3 子 + 1 空：+50（一步成四的威胁）
//    - 我方 2 子 + 2 空：+10
//    - 我方 1 子 + 3 空：+1
//    - 对方同样棋型按对称分值扣分（-50 / -10 / -1），
//      因此对手的一步胜威胁会被显著惩罚。
// 2. 中列（列 3）每枚我方棋子 +3、对方 -3：中列参与的四连窗口最多。
//
// 该分数只是有限深度下的启发式估计：正分不表示已证明必胜。

import { Board, Cell, COLS, ROWS } from "./rules";

const WINDOWS: [number, number][][] = (() => {
  const wins: [number, number][][] = [];
  const dirs: [number, number][] = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      for (const [dc, dr] of dirs) {
        const cells: [number, number][] = [];
        for (let i = 0; i < 4; i++) {
          const cc = c + dc * i;
          const rr = r + dr * i;
          if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) break;
          cells.push([cc, rr]);
        }
        if (cells.length === 4) wins.push(cells);
      }
    }
  }
  return wins;
})();

function windowScore(mine: number, empty: number): number {
  if (mine === 3 && empty === 1) return 50;
  if (mine === 2 && empty === 2) return 10;
  if (mine === 1 && empty === 3) return 1;
  return 0;
}

/** 从 player 视角的启发式分数 */
export function evaluate(board: Board, player: 1 | 2): number {
  const opponent = (player === 1 ? 2 : 1) as 1 | 2;
  let score = 0;
  for (const win of WINDOWS) {
    let mine = 0, theirs = 0, empty = 0;
    for (const [c, r] of win) {
      const v: Cell = board.grid[c][r];
      if (v === player) mine++;
      else if (v === opponent) theirs++;
      else empty++;
    }
    if (mine > 0 && theirs > 0) continue; // 双方都有子的窗口已无价值
    score += windowScore(mine, empty);
    score -= windowScore(theirs, empty);
  }
  for (let r = 0; r < ROWS; r++) {
    const v = board.grid[3][r];
    if (v === player) score += 3;
    else if (v === opponent) score -= 3;
  }
  return score;
}

/** 终局分基准，远大于任何启发式分（启发式绝对值上界约 69*50+18*3 < 4000） */
export const WIN_SCORE = 1_000_000;
