// SQLite 持久化（Node 内置 node:sqlite，无外部依赖）。
// 保存：局面（落子序列 + 规则版本）、分析报告（搜索配置 + 结果）。
// 失败输入在写入前完成全部验证，不留下半局。

import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { Board, RULE_VERSION } from "./rules";
import { AnalysisResult } from "./search";

export const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "connect4.db");

export interface GameRow {
  id: number;
  moves: number[];
  ruleVersion: string;
  createdAt: string;
}

export interface AnalysisRow {
  id: number;
  gameId: number;
  depth: number;
  nodeBudget: number;
  completed: boolean;
  result: AnalysisResult;
  createdAt: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string = DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        moves TEXT NOT NULL,
        rule_version TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL REFERENCES games(id),
        depth INTEGER NOT NULL,
        node_budget INTEGER NOT NULL,
        completed INTEGER NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /** 保存合法落子序列；非法序列抛错且不写入任何记录 */
  createGame(moves: number[]): GameRow {
    Board.fromMoves(moves); // 先完整验证
    const stmt = this.db.prepare("INSERT INTO games (moves, rule_version) VALUES (?, ?)");
    const r = stmt.run(JSON.stringify(moves), RULE_VERSION);
    return this.getGame(Number(r.lastInsertRowid))!;
  }

  getGame(id: number): GameRow | null {
    const row = this.db.prepare("SELECT * FROM games WHERE id = ?").get(id) as any;
    if (!row) return null;
    return { id: row.id, moves: JSON.parse(row.moves), ruleVersion: row.rule_version, createdAt: row.created_at };
  }

  saveAnalysis(gameId: number, result: AnalysisResult): AnalysisRow {
    const stmt = this.db.prepare(
      "INSERT INTO analyses (game_id, depth, node_budget, completed, result) VALUES (?, ?, ?, ?, ?)"
    );
    const r = stmt.run(gameId, result.depth, result.nodeBudget, result.completed ? 1 : 0, JSON.stringify(result));
    return this.getAnalysis(Number(r.lastInsertRowid))!;
  }

  getAnalysis(id: number): AnalysisRow | null {
    const row = this.db.prepare("SELECT * FROM analyses WHERE id = ?").get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      gameId: row.game_id,
      depth: row.depth,
      nodeBudget: row.node_budget,
      completed: !!row.completed,
      result: JSON.parse(row.result),
      createdAt: row.created_at,
    };
  }

  listAnalyses(gameId: number): AnalysisRow[] {
    const rows = this.db.prepare("SELECT id FROM analyses WHERE game_id = ? ORDER BY id").all(gameId) as any[];
    return rows.map((r) => this.getAnalysis(r.id)!);
  }

  close(): void {
    this.db.close();
  }
}
