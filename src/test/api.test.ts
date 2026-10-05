import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "../db";
import { createServer } from "../server";

let server: http.Server;
let base: string;
let store: Store;

async function req(method: string, p: string, body?: any): Promise<{ status: number; json: any }> {
  const res = await fetch(base + p, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

before(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "c4test-"));
  store = new Store(path.join(tmp, "test.db"));
  server = createServer(store);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

after(() => {
  server.close();
  store.close();
});

test("API 全流程：创建、棋盘、合法列、分析、应用、报告", async () => {
  const g = await req("POST", "/games", { moves: [0, 1, 0, 1, 0, 2] });
  assert.equal(g.status, 201);
  const id = g.json.id;
  const view = await req("GET", `/games/${id}`);
  assert.equal(view.status, 200);
  assert.ok(view.json.board.includes("0 1 2 3 4 5 6"));
  assert.equal(view.json.sideToMove, 1);
  const legal = await req("GET", `/games/${id}/legal`);
  assert.deepEqual(legal.json.legalColumns, [0, 1, 2, 3, 4, 5, 6]);
  const a = await req("POST", `/games/${id}/analyze`, { depth: 2, nodeBudget: 100000 });
  assert.equal(a.status, 201);
  assert.equal(a.json.bestColumn, 0);
  assert.ok(a.json.nodes > 0);
  const applied = await req("POST", `/games/${id}/apply`, { analysisId: a.json.analysisId });
  assert.equal(applied.status, 201);
  assert.deepEqual(applied.json.moves, [0, 1, 0, 1, 0, 2, 0]);
  const report = await req("GET", `/analyses/${a.json.analysisId}/export`);
  assert.equal(report.status, 200);
  assert.ok(String(report.json).includes("主变化"));
  const again = await req("POST", `/games/${id}/analyze`, { depth: 2, nodeBudget: 100000 });
  assert.equal(again.json.bestColumn, a.json.bestColumn, "重复分析结果一致");
});

test("API 错误码：非法序列、越界深度、未知局面", async () => {
  const bad = await req("POST", "/games", { moves: [0, 1, 0, 1, 0, 1, 0, 2] });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.error.code, "GAME_ALREADY_OVER");
  const badDepth = await req("POST", "/games/1/analyze", { depth: 9 });
  assert.equal(badDepth.status, 400);
  assert.equal(badDepth.json.error.code, "INVALID_DEPTH");
  const missing = await req("GET", "/games/9999");
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, "GAME_NOT_FOUND");
  const full = await req("POST", "/games", { moves: [0, 0, 0, 0, 0, 0, 0] });
  assert.equal(full.status, 422);
  assert.equal(full.json.error.code, "COLUMN_FULL");
});

test("失败输入不留下半局", async () => {
  const ok = await req("POST", "/games", { moves: [3, 3] });
  const id = ok.json.id;
  await req("POST", "/games", { moves: [0, 1, 0, 1, 0, 1, 0, 5] });
  const next = await req("POST", "/games", { moves: [4] });
  assert.equal(next.json.id, id + 1, "失败输入不应占用 id");
});
