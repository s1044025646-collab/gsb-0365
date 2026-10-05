// SQLite 持久化：保存合法落子序列(局面)与分析报告。
// 使用 Node 内置 node:sqlite（DatabaseSync），数据文件位于项目 data/ 目录。
// 旧局面与旧报告永久保留、可查询；深度与预算固定在报告记录中。

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { boardFromMoves, RuleViolation, RULES_VERSION } from './rules';
import { SearchResult } from './search';

export interface GameRow {
  id: string;
  moves: number[];
  rules_version: string;
  move_count: number;
  final_status: 'ongoing' | 'win_1' | 'win_2' | 'draw';
  created_at: string;
}

export interface ReportRow {
  id: string;
  game_id: string;
  depth: number;
  budget: number;
  complete: 0 | 1;
  best_move: number | null;
  score: number | null;
  principal_variation: number[];
  nodes: number;
  cutoffs: number;
  completed_root_columns: number[];
  created_at: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        moves TEXT NOT NULL,
        rules_version TEXT NOT NULL,
        move_count INTEGER NOT NULL,
        final_status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id),
        depth INTEGER NOT NULL,
        budget INTEGER NOT NULL,
        complete INTEGER NOT NULL,
        best_move INTEGER,
        score INTEGER,
        principal_variation TEXT NOT NULL,
        nodes INTEGER NOT NULL,
        cutoffs INTEGER NOT NULL,
        completed_root_columns TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /**
   * 保存落子序列。先用规则完整验证：非法输入在写库前抛错，
   * 因此不会留下半局；验证通过后在事务中插入。
   * 完全相同的序列复用同一 id（幂等，便于重复分析与查询）。
   */
  saveGame(moves: number[]): GameRow {
    // 完整验证（任一步非法即抛出 RuleViolation）
    const board = boardFromMoves(moves);
    const st = board.status();
    const finalStatus = st.winner === 1 ? 'win_1' : st.winner === 2 ? 'win_2' : st.draw ? 'draw' : 'ongoing';
    const id = gameIdFor(moves);
    const createdAt = new Date().toISOString();
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO games (id, moves, rules_version, move_count, final_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(id, JSON.stringify(moves), RULES_VERSION, moves.length, finalStatus, createdAt);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.getGame(id)!;
  }

  getGame(id: string): GameRow | null {
    const row = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToGame(row) : null;
  }

  listGames(): GameRow[] {
    const rows = this.db.prepare('SELECT * FROM games ORDER BY created_at DESC, id').all() as Array<
      Record<string, unknown>
    >;
    return rows.map(rowToGame);
  }

  saveReport(gameId: string, result: SearchResult): ReportRow {
    const game = this.getGame(gameId);
    if (!game) throw Object.assign(new Error('局面不存在'), { code: 'GAME_NOT_FOUND' });
    const createdAt = new Date().toISOString();
    // 同一局面 + 同一深度 + 同一预算复用同一报告 id（幂等）
    const id = `${gameId}:d${result.depth}:b${result.budget}`;
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO reports
             (id, game_id, depth, budget, complete, best_move, score, principal_variation,
              nodes, cutoffs, completed_root_columns, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          gameId,
          result.depth,
          result.budget,
          result.complete ? 1 : 0,
          result.bestMove,
          result.score,
          JSON.stringify(result.principalVariation),
          result.nodes,
          result.cutoffs,
          JSON.stringify(result.completedRootColumns),
          createdAt
        );
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.getReport(id)!;
  }

  getReport(id: string): ReportRow | null {
    const row = this.db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToReport(row) : null;
  }

  listReports(gameId?: string): ReportRow[] {
    const rows = gameId
      ? (this.db
          .prepare('SELECT * FROM reports WHERE game_id = ? ORDER BY created_at DESC')
          .all(gameId) as Array<Record<string, unknown>>)
      : (this.db.prepare('SELECT * FROM reports ORDER BY created_at DESC').all() as Array<
          Record<string, unknown>
        >);
    return rows.map(rowToReport);
  }
}

function rowToGame(row: Record<string, unknown>): GameRow {
  return {
    id: row.id as string,
    moves: JSON.parse(row.moves as string) as number[],
    rules_version: row.rules_version as string,
    move_count: row.move_count as number,
    final_status: row.final_status as GameRow['final_status'],
    created_at: row.created_at as string,
  };
}

function rowToReport(row: Record<string, unknown>): ReportRow {
  return {
    id: row.id as string,
    game_id: row.game_id as string,
    depth: row.depth as number,
    budget: row.budget as number,
    complete: row.complete as 0 | 1,
    best_move: (row.best_move ?? null) as number | null,
    score: (row.score ?? null) as number | null,
    principal_variation: JSON.parse(row.principal_variation as string) as number[],
    nodes: row.nodes as number,
    cutoffs: row.cutoffs as number,
    completed_root_columns: JSON.parse(row.completed_root_columns as string) as number[],
    created_at: row.created_at as string,
  };
}

/** 局面 id：规则版本 + 序列的稳定短哈希（FNV-1a）。 */
export function gameIdFor(moves: number[]): string {
  const text = `${RULES_VERSION}/${moves.join(',')}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `g${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export { RuleViolation };
