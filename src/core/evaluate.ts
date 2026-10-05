// 公开的简单棋型启发式评分（深度限制处的非终局评估）
// 参考公开的 Connect Four 教学评估：枚举棋盘上全部长度为 4 的窗口
// （水平、竖直、两条斜线），统计窗口内双方棋子数量并打分，
// 另加一个轻微的中心列占位奖励。该函数只用于深度截断处的启发式，
// 永远不会超过终局分数；它是“局面看起来对谁有利”的估计，不是必胜证明。

import { Board, COLS, ROWS, Player } from './rules';

export function opponent(player: Player): Player {
  return player === 1 ? 2 : 1;
}

/** 单个四格窗口的启发式贡献（站在 player 角度）。 */
function scoreWindow(window: number[], player: Player): number {
  const mine = window.filter((c) => c === player).length;
  const theirs = window.filter((c) => c === opponent(player)).length;
  if (mine > 0 && theirs > 0) return 0; // 被对方挡住，本窗口无四连潜力
  if (mine === 0 && theirs === 0) return 0;
  const n = mine > 0 ? mine : theirs;
  const sign = mine > 0 ? 1 : -1;
  // 1 枚=1，2 枚=10，3 枚=50（公开教学常用权重）
  const base = n === 3 ? 50 : n === 2 ? 10 : 1;
  return sign * base;
}

/**
 * 站在 player 角度评估当前局面（非终局）。
 * 启发式上界远小于终局分数 WIN，且镜像对称（左右翻转评分一致）。
 */
export function evaluate(board: Board, player: Player): number {
  let score = 0;

  // 中心列轻微奖励：中心列参与的四连窗口最多（公开启发式）。
  // 权重 3，保证其为“偏好”而非压倒棋型；该奖励左右镜像不变。
  const center = Math.floor(COLS / 2);
  for (let r = 0; r < ROWS; r++) {
    if (board.grid[r][center] === player) score += 3;
    else if (board.grid[r][center] === opponent(player)) score -= 3;
  }

  // 水平窗口
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      score += scoreWindow([board.grid[r][c], board.grid[r][c + 1], board.grid[r][c + 2], board.grid[r][c + 3]], player);
    }
  }
  // 竖直窗口
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r <= ROWS - 4; r++) {
      score += scoreWindow([board.grid[r][c], board.grid[r + 1][c], board.grid[r + 2][c], board.grid[r + 3][c]], player);
    }
  }
  // 斜线窗口 /
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      score += scoreWindow([board.grid[r][c], board.grid[r + 1][c + 1], board.grid[r + 2][c + 2], board.grid[r + 3][c + 3]], player);
    }
  }
  // 斜线窗口 \
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 3; c < COLS; c++) {
      score += scoreWindow([board.grid[r][c], board.grid[r + 1][c - 1], board.grid[r + 2][c - 2], board.grid[r + 3][c - 3]], player);
    }
  }
  return score;
}

/** 启发式观察说明（用于报告解释，不参与决策）。 */
export const HEURISTIC_DESCRIPTION =
  '枚举棋盘全部 69 个长度为 4 的窗口（水平 24、竖直 21、斜线各 12）：'
  + '窗口仅含己方棋子时按 1/2/3 枚计 1/10/50 分，仅含对方棋子取负，混有双方棋子计 0；'
  + '另对中心列(列3)每枚棋子加 ±3 的轻微占位奖励。分数仅表示棋型潜力，不是胜负证明。';
