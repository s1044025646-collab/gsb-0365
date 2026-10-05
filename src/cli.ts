// CLI：create / board / legal / analyze / apply / report / demo / serve

import { Board } from "./rules";
import { analyze, DEFAULT_NODE_BUDGET } from "./search";
import { Store } from "./db";
import { boardView, analysisReport } from "./report";
import { startServer } from "./server";

const store = new Store();

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function mustGame(id: number) {
  const g = store.getGame(id);
  if (!g) {
    console.error(`错误：局面 #${id} 不存在`);
    process.exit(1);
  }
  return g;
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "create": {
      // 例：node dist/cli.js create 0 1 0 1 0 2
      const moves = args.map(Number);
      const g = store.createGame(moves);
      console.log(`已保存局面 #${g.id}，落子序列：${g.moves.join(" ")}`);
      console.log(Board.fromMoves(g.moves).toString());
      break;
    }
    case "board": {
      const g = mustGame(Number(args[0]));
      console.log(Board.fromMoves(g.moves).toString());
      console.log(boardView(Board.fromMoves(g.moves)).status);
      break;
    }
    case "legal": {
      const g = mustGame(Number(args[0]));
      console.log(`合法列：${Board.fromMoves(g.moves).legalColumns().join(" ") || "（无，已终局）"}`);
      break;
    }
    case "analyze": {
      const g = mustGame(Number(args[0]));
      const depth = Number(opt(args, "depth") ?? 4);
      const nodeBudget = Number(opt(args, "budget") ?? DEFAULT_NODE_BUDGET);
      const board = Board.fromMoves(g.moves);
      const row = store.saveAnalysis(g.id, analyze(board, depth, nodeBudget));
      console.log(analysisReport(board, row));
      break;
    }
    case "apply": {
      // 例：node dist/cli.js apply <gameId> <analysisId>
      const g = mustGame(Number(args[0]));
      const a = store.getAnalysis(Number(args[1]));
      if (!a || a.gameId !== g.id || !a.result.completed || a.result.bestColumn === null) {
        console.error("错误：该分析无可用建议");
        process.exit(1);
      }
      const ng = store.createGame([...g.moves, a.result.bestColumn]);
      console.log(`已应用建议列 ${a.result.bestColumn}，生成新局面 #${ng.id}：${ng.moves.join(" ")}`);
      console.log(Board.fromMoves(ng.moves).toString());
      break;
    }
    case "report": {
      const a = store.getAnalysis(Number(args[0]));
      if (!a) {
        console.error(`错误：分析报告 #${args[0]} 不存在`);
        process.exit(1);
      }
      const g = mustGame(a.gameId);
      console.log(analysisReport(Board.fromMoves(g.moves), a));
      break;
    }
    case "serve": {
      const port = Number(opt(args, "port") ?? process.env.PORT ?? 0);
      startServer(port);
      break;
    }
    case "demo": {
      demo();
      break;
    }
    default:
      console.log(`用法：
  node dist/cli.js create <列...>        保存落子序列（如 create 0 1 0 1 0 2）
  node dist/cli.js board <局面id>        查看文本棋盘
  node dist/cli.js legal <局面id>        查看合法列
  node dist/cli.js analyze <局面id> [--depth 1-6] [--budget N]
  node dist/cli.js apply <局面id> <分析id>   应用建议生成新局面
  node dist/cli.js report <分析id>       查看分析报告
  node dist/cli.js serve [--port N]      启动 API（默认自动选空闲端口）
  node dist/cli.js demo                  运行内置演示`);
  }
}

function demo() {
  console.log("=== 演示 1：序列 0 1 0 1 0 2 后，当前方（X）在列 0 立即获胜 ===");
  const g1 = store.createGame([0, 1, 0, 1, 0, 2]);
  const b1 = Board.fromMoves(g1.moves);
  console.log(b1.toString());
  const a1 = store.saveAnalysis(g1.id, analyze(b1, 4, DEFAULT_NODE_BUDGET));
  console.log(analysisReport(b1, a1));

  console.log("\n=== 演示 2：序列 0 1 0 1 2 1 后，应识别对手在列 1 的威胁 ===");
  const g2 = store.createGame([0, 1, 0, 1, 2, 1]);
  const b2 = Board.fromMoves(g2.moves);
  console.log(b2.toString());
  const a2 = store.saveAnalysis(g2.id, analyze(b2, 4, DEFAULT_NODE_BUDGET));
  console.log(analysisReport(b2, a2));
}

main();
