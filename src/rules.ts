// 规则模块：标准 7 列 6 行重力四子棋。
// 坐标约定：列 col ∈ [0,6] 从左到右，行 row ∈ [0,5] 从底到顶。
// 棋子：1 = 先手（X），2 = 后手（O）。行动方由已落子数决定。

export const COLS = 7;
export const ROWS = 6;
export const RULE_VERSION = "connect4-v1";

export type Cell = 0 | 1 | 2;

export type GameErrorCode =
  | "COLUMN_OUT_OF_RANGE"
  | "COLUMN_FULL"
  | "GAME_ALREADY_OVER"
  | "INVALID_MOVE_TYPE";

export class GameError extends Error {
  constructor(public code: GameErrorCode, message: string) {
    super(message);
    this.name = "GameError";
  }
}

export type GameStatus =
  | { kind: "ongoing" }
  | { kind: "win"; winner: 1 | 2; line: [number, number][] }
  | { kind: "draw" };

const DIRECTIONS: [number, number][] = [
  [1, 0], // 水平
  [0, 1], // 竖直
  [1, 1], // 斜线 /
  [1, -1], // 斜线 \
];

export class Board {
  // grid[col][row]，row 0 为底部
  readonly grid: Cell[][];
  readonly heights: number[];
  moveCount = 0;
  status: GameStatus = { kind: "ongoing" };

  constructor() {
    this.grid = Array.from({ length: COLS }, () => Array<Cell>(ROWS).fill(0));
    this.heights = Array<number>(COLS).fill(0);
  }

  clone(): Board {
    const b = new Board();
    for (let c = 0; c < COLS; c++) {
      b.grid[c] = this.grid[c].slice() as Cell[];
      b.heights[c] = this.heights[c];
    }
    b.moveCount = this.moveCount;
    b.status = this.status;
    return b;
  }

  /** 当前行动方：1 先手，2 后手 */
  sideToMove(): 1 | 2 {
    return (this.moveCount % 2 === 0 ? 1 : 2) as 1 | 2;
  }

  isOver(): boolean {
    return this.status.kind !== "ongoing";
  }

  legalColumns(): number[] {
    if (this.isOver()) return [];
    const out: number[] = [];
    for (let c = 0; c < COLS; c++) if (this.heights[c] < ROWS) out.push(c);
    return out;
  }

  /** 落子；非法时抛 GameError，棋盘保持不变 */
  play(col: number): number {
    if (!Number.isInteger(col)) throw new GameError("INVALID_MOVE_TYPE", `列编号必须是整数，收到 ${col}`);
    if (col < 0 || col >= COLS) throw new GameError("COLUMN_OUT_OF_RANGE", `列 ${col} 越界（合法范围 0-${COLS - 1}）`);
    if (this.isOver()) throw new GameError("GAME_ALREADY_OVER", "对局已终局，拒绝继续落子");
    if (this.heights[col] >= ROWS) throw new GameError("COLUMN_FULL", `列 ${col} 已满`);
    const row = this.heights[col];
    this.grid[col][row] = this.sideToMove();
    this.heights[col]++;
    this.moveCount++;
    this.updateStatus(col, row);
    return row;
  }

  /** 撤销一步落子，恢复棋盘与列高。仅用于搜索内部。 */
  undo(col: number): void {
    const row = this.heights[col] - 1;
    this.grid[col][row] = 0;
    this.heights[col]--;
    this.moveCount--;
    this.status = { kind: "ongoing" };
  }

  private updateStatus(col: number, row: number): void {
    const p = this.grid[col][row];
    for (const [dc, dr] of DIRECTIONS) {
      const line: [number, number][] = [[col, row]];
      for (const sign of [1, -1]) {
        let c = col + dc * sign;
        let r = row + dr * sign;
        while (c >= 0 && c < COLS && r >= 0 && r < ROWS && this.grid[c][r] === p) {
          line.push([c, r]);
          c += dc * sign;
          r += dr * sign;
        }
      }
      if (line.length >= 4) {
        this.status = { kind: "win", winner: p as 1 | 2, line };
        return;
      }
    }
    if (this.moveCount === COLS * ROWS) this.status = { kind: "draw" };
  }

  /** 从列编号序列构造局面，逐步验证；任何一步非法则整体失败 */
  static fromMoves(moves: number[]): Board {
    if (!Array.isArray(moves)) throw new GameError("INVALID_MOVE_TYPE", "落子序列必须是数组");
    if (moves.length > COLS * ROWS) throw new GameError("INVALID_MOVE_TYPE", `序列过长（最多 ${COLS * ROWS} 步）`);
    const b = new Board();
    for (const m of moves) b.play(m);
    return b;
  }

  /** 文本棋盘，顶部在前；X=先手 O=后手 .=空 */
  toString(): string {
    const rows: string[] = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      let line = "";
      for (let c = 0; c < COLS; c++) {
        const v = this.grid[c][r];
        line += (v === 1 ? "X" : v === 2 ? "O" : ".") + " ";
      }
      rows.push(line.trimEnd());
    }
    rows.push("0 1 2 3 4 5 6");
    return rows.join("\n");
  }
}
