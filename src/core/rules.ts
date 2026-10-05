// 重力四子棋（标准 7 列 × 6 行）规则模块
// 规则版本：standard-7x6-v1

export const RULES_VERSION = 'standard-7x6-v1';
export const COLS = 7;
export const ROWS = 6;

// 棋子：0 空，1 红（先手），2 黄（后手）
export type Cell = 0 | 1 | 2;
export type Player = 1 | 2;

export class RuleViolation extends Error {
  code: 'COLUMN_OUT_OF_RANGE' | 'COLUMN_FULL' | 'GAME_ALREADY_OVER';
  constructor(code: 'COLUMN_OUT_OF_RANGE' | 'COLUMN_FULL' | 'GAME_ALREADY_OVER', message: string) {
    super(message);
    this.code = code;
  }
}

/** 局面：grid[row][col]，row=0 为棋盘最底行。 */
export class Board {
  grid: Cell[][];
  /** 每列已落棋子数 */
  heights: number[];
  /** 从空棋盘开始的列编号序列 */
  moves: number[];
  /** 终局胜方：1|2 为胜方；null 表示尚未因四连终局（平局也为 null） */
  winner: Player | null = null;

  constructor() {
    this.grid = Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(0));
    this.heights = Array<number>(COLS).fill(0);
    this.moves = [];
  }

  clone(): Board {
    const b = new Board();
    b.grid = this.grid.map((r) => r.slice() as Cell[]);
    b.heights = this.heights.slice();
    b.moves = this.moves.slice();
    b.winner = this.winner;
    return b;
  }

  /** 当前行动方：红先，步数为偶数时轮到红(1)。 */
  currentPlayer(): Player {
    return this.moves.length % 2 === 0 ? 1 : 2;
  }

  isFull(): boolean {
    return this.moves.length >= COLS * ROWS;
  }

  legalColumns(): number[] {
    if (this.status().over) return [];
    const cols: number[] = [];
    for (let c = 0; c < COLS; c++) {
      if (this.heights[c] < ROWS) cols.push(c);
    }
    return cols;
  }

  /**
   * 落子并验证：越界、满列、终局后继续均拒绝。
   * 返回落子坐标；调用方可使用 undo() 撤销。
   */
  apply(col: number): { row: number; player: Player } {
    if (typeof col !== 'number' || !Number.isInteger(col) || col < 0 || col >= COLS) {
      throw new RuleViolation(
        'COLUMN_OUT_OF_RANGE',
        `列编号必须是 0..${COLS - 1} 的整数，收到 ${String(col)}`
      );
    }
    const st = this.status();
    if (st.over) {
      throw new RuleViolation(
        'GAME_ALREADY_OVER',
        st.draw ? '局面已终局（平局），不能继续落子' : `局面已终局（玩家 ${st.winner} 获胜），不能继续落子`
      );
    }
    if (this.heights[col] >= ROWS) {
      throw new RuleViolation('COLUMN_FULL', `第 ${col} 列已满，不能落子`);
    }
    const player = this.currentPlayer();
    const row = this.heights[col];
    this.grid[row][col] = player;
    this.heights[col] += 1;
    this.moves.push(col);
    if (this.connectsFour(row, col, player)) this.winner = player;
    return { row, player };
  }

  /** 撤销最后一步，必须恢复棋盘格与列高，并清除终局标记。 */
  undo(): void {
    const col = this.moves.pop();
    if (col === undefined) throw new Error('没有可撤销的落子');
    const row = this.heights[col] - 1;
    this.grid[row][col] = 0;
    this.heights[col] = row;
    this.winner = null;
  }

  /** 终局状态。 */
  status(): { over: boolean; winner: Player | null; draw: boolean } {
    if (this.winner !== null) return { over: true, winner: this.winner, draw: false };
    if (this.isFull()) return { over: true, winner: null, draw: true };
    return { over: false, winner: null, draw: false };
  }

  /** 检查落在 (row,col) 的棋子是否在水平/竖直/两条斜线形成四连。 */
  private connectsFour(row: number, col: number, player: Player): boolean {
    const dirs: Array<[number, number]> = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ];
    for (const [dr, dc] of dirs) {
      let count = 1;
      for (const sign of [1, -1]) {
        let r = row + dr * sign;
        let c = col + dc * sign;
        while (r >= 0 && r < ROWS && c >= 0 && c < COLS && this.grid[r][c] === player) {
          count += 1;
          r += dr * sign;
          c += dc * sign;
        }
      }
      if (count >= 4) return true;
    }
    return false;
  }
}

/** 从列编号序列构造合法局面；任一步非法则抛错（调用方事务回滚，不留下半局）。 */
export function boardFromMoves(moves: number[]): Board {
  const board = new Board();
  for (const col of moves) board.apply(col);
  return board;
}

/** 文本棋盘：row 5 在顶部，列编号标注在底部。X=红(先手) O=黄(后手)。 */
export function renderBoard(board: Board): string {
  const lines: string[] = [];
  for (let r = ROWS - 1; r >= 0; r--) {
    const cells = board.grid[r].map((cell) => (cell === 0 ? '.' : cell === 1 ? 'X' : 'O'));
    lines.push(`|${cells.join(' ')}|  row ${r}`);
  }
  lines.push(` ${Array.from({ length: COLS }, (_, i) => i).join(' ')}  col`);
  lines.push(' X=红(先手1)  O=黄(后手2)  .=空');
  return lines.join('\n');
}
