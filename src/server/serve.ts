// HTTP API（仅 API，无图形界面）。默认选择空闲端口，可用 PORT 环境变量指定。

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { boardFromMoves, renderBoard, RuleViolation } from '../core/rules';
import { searchRoot, MAX_BUDGET, MAX_DEPTH, verifyPrincipalVariation } from '../core/search';
import { Store } from '../core/db';
import { buildExport, renderTextReport } from '../core/report';

const DATA_DIR = process.env.C4_DATA_DIR || join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'connect4.sqlite');
const MAX_MOVES = 42;

interface ApiError {
  error: string;
  code: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  const body: ApiError = { error: message, code };
  sendJson(res, status, body);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function normalizeMoves(value: unknown): { moves?: number[]; error?: ApiError } {
  if (!Array.isArray(value)) {
    return { error: { code: 'INVALID_MOVES', error: 'moves 必须是列编号数组，例如 [0,1,0]' } };
  }
  if (value.length > MAX_MOVES) {
    return { error: { code: 'INVALID_MOVES', error: `序列长度不能超过 ${MAX_MOVES}` } };
  }
  const moves: number[] = [];
  for (const v of value) {
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      return { error: { code: 'INVALID_MOVES', error: '每个落子必须是整数列编号（0..6）' } };
    }
    moves.push(v);
  }
  return { moves };
}

export function createApp(store: Store) {
  const server = createServer(async (req, res) => {
    try {
      await route(store, req, res);
    } catch (err) {
      if (err instanceof SyntaxError) {
        sendError(res, 400, 'INVALID_JSON', '请求体不是合法 JSON');
      } else if (err instanceof RuleViolation) {
        sendError(res, 422, err.code, err.message);
      } else {
        sendError(res, 500, 'INTERNAL', (err as Error).message);
      }
    }
  });
  return server;
}

async function route(store: Store, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method || 'GET';

  if (method === 'GET' && path === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  // 需要 moves 输入的 POST 接口统一从 body 读取序列并构造局面
  if (method === 'POST') {
    const body = (await readJson(req)) as { moves?: unknown; depth?: unknown; budget?: unknown; column?: unknown };
    const norm = normalizeMoves(body.moves);
    if (norm.error) {
      sendError(res, 400, norm.error.code, norm.error.error);
      return;
    }
    const moves = norm.moves!;

    if (path === '/games') {
      const game = store.saveGame(moves); // 非法序列在此抛出 RuleViolation
      sendJson(res, 201, game);
      return;
    }

    const board = boardFromMoves(moves);

    if (path === '/board') {
      const st = board.status();
      sendJson(res, 200, {
        moves,
        board: renderBoard(board),
        currentPlayer: st.over ? null : board.currentPlayer(),
        legalColumns: board.legalColumns(),
        status: st,
      });
      return;
    }

    if (path === '/legal') {
      sendJson(res, 200, { moves, legalColumns: board.legalColumns() });
      return;
    }

    if (path === '/apply-suggestion') {
      // 在给定合法局面上应用分析建议列，返回保存后的新局面；终局局面不产生建议。
      const depth = parsePosInt(body.depth, 4);
      const budget = parsePosInt(body.budget, 200000);
      const analysis = searchRoot(board, depth, budget);
      if (board.status().over) {
        sendError(res, 422, 'GAME_ALREADY_OVER', '局面已终局，无法应用建议');
        return;
      }
      if (!analysis.complete || analysis.bestMove === null) {
        sendError(res, 409, 'BUDGET_EXHAUSTED', '预算不足，未产生可靠建议，请提高预算');
        return;
      }
      const nextMoves = [...moves, analysis.bestMove];
      const game = store.saveGame(nextMoves);
      sendJson(res, 201, { previousMoves: moves, suggestedColumn: analysis.bestMove, game });
      return;
    }

    if (path === '/verify-pv') {
      // 用与 /analyze 相同配置重新分析，并逐步校验主变化可在真实规则下执行。
      const depth = parsePosInt(body.depth, 4);
      const budget = parsePosInt(body.budget, 200000);
      const analysis = searchRoot(board, depth, budget);
      const check = verifyPrincipalVariation(board, analysis.principalVariation);
      sendJson(res, 200, { moves, depth, budget, principalVariation: analysis.principalVariation, ...check });
      return;
    }

    if (path === '/analyze') {
      const depth = parsePosInt(body.depth, 4, MAX_DEPTH, 'INVALID_DEPTH', `深度须为 1..${MAX_DEPTH}`);
      const budget = parsePosInt(body.budget, 200000, MAX_BUDGET, 'INVALID_BUDGET', `预算须为 1..${MAX_BUDGET}`);
      const game = store.saveGame(moves);
      const analysisBoard = boardFromMoves(moves);
      const result = searchRoot(analysisBoard, depth, budget);
      const report = store.saveReport(game.id, result);
      sendJson(res, 201, {
        gameId: game.id,
        reportId: report.id,
        complete: result.complete,
        depth: result.depth,
        budget: result.budget,
        bestMove: result.bestMove,
        score: result.score,
        principalVariation: result.principalVariation,
        nodes: result.nodes,
        cutoffs: result.cutoffs,
        completedRootColumns: result.completedRootColumns,
        currentPlayer: analysisBoard.status().over ? null : analysisBoard.currentPlayer(),
        terminal: analysisBoard.status(),
      });
      return;
    }

    sendError(res, 404, 'NOT_FOUND', `无此接口: ${path}`);
    return;
  }

  if (method === 'GET' && path === '/games') {
    sendJson(res, 200, store.listGames());
    return;
  }
  if (method === 'GET' && path.startsWith('/games/')) {
    const id = path.slice('/games/'.length);
    const game = store.getGame(id);
    if (!game) return sendError(res, 404, 'GAME_NOT_FOUND', '局面不存在');
    sendJson(res, 200, game);
    return;
  }
  if (method === 'GET' && path.startsWith('/reports/') && path.endsWith('/export')) {
    const id = path.slice('/reports/'.length, -'/export'.length);
    const report = store.getReport(id);
    if (!report) return sendError(res, 404, 'REPORT_NOT_FOUND', '报告不存在');
    const game = store.getGame(report.game_id);
    if (!game) return sendError(res, 404, 'GAME_NOT_FOUND', '报告关联的局面不存在');
    const payload = buildExport(game.moves, report);
    const format = url.searchParams.get('format');
    if (format === 'text') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(renderTextReport(payload));
    } else {
      sendJson(res, 200, payload);
    }
    return;
  }
  if (method === 'GET' && path.startsWith('/reports/')) {
    const id = path.slice('/reports/'.length);
    const report = store.getReport(id);
    if (!report) return sendError(res, 404, 'REPORT_NOT_FOUND', '报告不存在');
    sendJson(res, 200, report);
    return;
  }
  if (method === 'GET' && path === '/reports') {
    const gameId = url.searchParams.get('gameId') || undefined;
    sendJson(res, 200, store.listReports(gameId));
    return;
  }

  sendError(res, 404, 'NOT_FOUND', `无此接口: ${method} ${path}`);
}

function parsePosInt(
  value: unknown,
  fallback: number,
  max?: number,
  code?: string,
  message?: string
): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || (max !== undefined && value > max)) {
    throw Object.assign(new Error(message || '参数须为正整数'), { code: code || 'INVALID_PARAM' });
  }
  return value;
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error('无法获取空闲端口'));
      }
    });
    srv.on('error', reject);
  });
}

async function main(): Promise<void> {
  const store = new Store(DB_PATH);
  const app = createApp(store);
  const requested = process.env.PORT ? Number(process.env.PORT) : 0;
  const port = requested > 0 ? requested : await pickFreePort();
  app.listen(port, '127.0.0.1', () => {
    console.log(`重力四子棋分析后端已启动: http://127.0.0.1:${port}`);
    console.log(`数据目录: ${DATA_DIR}`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
