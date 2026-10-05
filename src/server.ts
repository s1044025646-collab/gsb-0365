// HTTP API（Node 内置 http，无外部依赖）。
// 错误统一为 { "error": { "code", "message" } }。

import * as http from "node:http";
import { Board, GameError } from "./rules";
import { analyze, MIN_DEPTH, MAX_DEPTH, DEFAULT_NODE_BUDGET, MAX_NODE_BUDGET } from "./search";
import { Store } from "./db";
import { boardView, analysisReport } from "./report";

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function parseMoves(body: any): number[] {
  if (!body || !Array.isArray(body.moves)) throw new ApiError(400, "BAD_REQUEST", "请求体需为 { \"moves\": number[] }");
  return body.moves;
}

function parseDepthBudget(body: any): { depth: number; nodeBudget: number } {
  const depth = body?.depth ?? 4;
  const nodeBudget = body?.nodeBudget ?? DEFAULT_NODE_BUDGET;
  if (!Number.isInteger(depth) || depth < MIN_DEPTH || depth > MAX_DEPTH) {
    throw new ApiError(400, "INVALID_DEPTH", `depth 必须是 ${MIN_DEPTH}-${MAX_DEPTH} 的整数`);
  }
  if (!Number.isInteger(nodeBudget) || nodeBudget < 1 || nodeBudget > MAX_NODE_BUDGET) {
    throw new ApiError(400, "INVALID_NODE_BUDGET", `nodeBudget 必须是 1-${MAX_NODE_BUDGET} 的整数`);
  }
  return { depth, nodeBudget };
}

function mustGame(store: Store, id: number) {
  const g = store.getGame(id);
  if (!g) throw new ApiError(404, "GAME_NOT_FOUND", `局面 #${id} 不存在`);
  return g;
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "请求体过大");
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "BAD_JSON", "请求体不是合法 JSON");
  }
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    const send = (status: number, obj: any, text = false) => {
      res.writeHead(status, { "Content-Type": text ? "text/plain; charset=utf-8" : "application/json; charset=utf-8" });
      res.end(text ? obj : JSON.stringify(obj, null, 2));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";
      const id = parts[1] !== undefined ? Number(parts[1]) : NaN;
      if (parts[1] !== undefined && !Number.isInteger(id)) throw new ApiError(400, "BAD_ID", "id 必须是整数");

      // POST /games {moves}
      if (method === "POST" && parts[0] === "games" && parts.length === 1) {
        const game = store.createGame(parseMoves(await readBody(req)));
        return send(201, { id: game.id, moves: game.moves, ruleVersion: game.ruleVersion });
      }
      // GET /games/:id
      if (method === "GET" && parts[0] === "games" && parts.length === 2) {
        const g = mustGame(store, id);
        return send(200, { id: g.id, moves: g.moves, ruleVersion: g.ruleVersion, ...boardView(Board.fromMoves(g.moves)) });
      }
      // GET /games/:id/legal
      if (method === "GET" && parts[0] === "games" && parts[2] === "legal") {
        const g = mustGame(store, id);
        return send(200, { legalColumns: Board.fromMoves(g.moves).legalColumns() });
      }
      // POST /games/:id/analyze {depth?, nodeBudget?}
      if (method === "POST" && parts[0] === "games" && parts[2] === "analyze") {
        const g = mustGame(store, id);
        const { depth, nodeBudget } = parseDepthBudget(await readBody(req));
        const board = Board.fromMoves(g.moves);
        const row = store.saveAnalysis(id, analyze(board, depth, nodeBudget));
        return send(201, { analysisId: row.id, ...row.result });
      }
      // POST /games/:id/apply {analysisId} -> 应用建议生成新局面
      if (method === "POST" && parts[0] === "games" && parts[2] === "apply") {
        const g = mustGame(store, id);
        const body = await readBody(req);
        const a = store.getAnalysis(body.analysisId);
        if (!a || a.gameId !== id) throw new ApiError(404, "ANALYSIS_NOT_FOUND", "该局面下不存在此分析报告");
        if (!a.result.completed || a.result.bestColumn === null) {
          throw new ApiError(409, "NO_SUGGESTION", "该分析无可用建议（未完成或局面已终局）");
        }
        const game = store.createGame([...g.moves, a.result.bestColumn]);
        return send(201, { id: game.id, moves: game.moves, applied: a.result.bestColumn });
      }
      // GET /analyses/:id （JSON） / GET /analyses/:id/export （文本报告）
      if (method === "GET" && parts[0] === "analyses" && (parts.length === 2 || parts[2] === "export")) {
        const a = store.getAnalysis(id);
        if (!a) throw new ApiError(404, "ANALYSIS_NOT_FOUND", `分析报告 #${id} 不存在`);
        const g = mustGame(store, a.gameId);
        if (parts[2] === "export") return send(200, analysisReport(Board.fromMoves(g.moves), a), true);
        return send(200, { ...a, board: Board.fromMoves(g.moves).toString() });
      }
      throw new ApiError(404, "NOT_FOUND", `未知路由：${method} ${url.pathname}`);
    } catch (e) {
      if (e instanceof ApiError) return send(e.status, { error: { code: e.code, message: e.message } });
      if (e instanceof GameError) return send(422, { error: { code: e.code, message: e.message } });
      if (e instanceof Error && /深度|预算/.test(e.message)) return send(400, { error: { code: "INVALID_CONFIG", message: e.message } });
      return send(500, { error: { code: "INTERNAL", message: String(e) } });
    }
  });
}

export function startServer(port: number): Promise<number> {
  const store = new Store();
  const server = createServer(store);
  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      console.log(`API 服务已启动：http://127.0.0.1:${actual}`);
      resolve(actual);
    });
  });
}

if (require.main === module) {
  // 默认 0 = 由系统分配空闲端口；可用 PORT 环境变量或 --port 指定
  const argPort = process.argv.find((a) => a.startsWith("--port="));
  const port = argPort ? Number(argPort.split("=")[1]) : Number(process.env.PORT ?? 0);
  startServer(port);
}
