#!/usr/bin/env node
// 命令行接口（中文输出）。
// 用法见 README，例如：
//   node dist/cli.js board 0,1,0,1,0,2
//   node dist/cli.js analyze 0,1,0,1,2,1 --depth 4 --budget 200000
//   node dist/cli.js demo

import { join } from 'node:path';
import { boardFromMoves, renderBoard } from './core/rules';
import { searchRoot, verifyPrincipalVariation } from './core/search';
import { Store, gameIdFor } from './core/db';
import { buildExport, renderTextReport } from './core/report';

const DATA_DIR = process.env.C4_DATA_DIR || join(process.cwd(), 'data');

function parseMoves(text: string): number[] {
  if (text.trim() === '') return [];
  return text.split(',').map((s) => Number(s.trim()));
}

function parseFlags(args: string[]): { depth: number; budget: number; rest: string[] } {
  let depth = 4;
  let budget = 200000;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--depth') depth = Number(args[++i]);
    else if (args[i] === '--budget') budget = Number(args[++i]);
    else rest.push(args[i]);
  }
  return { depth, budget, rest };
}

function printLine(s: string): void {
  process.stdout.write(s + '\n');
}

function main(): void {
  const [command, ...rawArgs] = process.argv.slice(2);
  const store = new Store(join(DATA_DIR, 'connect4.sqlite'));
  try {
    run(store, command || 'help', rawArgs);
  } catch (err) {
    const e = err as { code?: string; message: string };
    process.stderr.write(`错误${e.code ? ` [${e.code}]` : ''}: ${e.message}\n`);
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

function run(store: Store, command: string, rawArgs: string[]): void {
  switch (command) {
    case 'save': {
      const moves = parseMoves(rawArgs[0] || '');
      const game = store.saveGame(moves);
      printLine(`已保存局面 id=${game.id} 状态=${game.final_status} 序列=[${moves.join(', ')}]`);
      break;
    }
    case 'board': {
      const moves = parseMoves(rawArgs[0] || '');
      const board = boardFromMoves(moves);
      printLine(renderBoard(board));
      const st = board.status();
      if (st.over) printLine(`终局：${st.draw ? '平局' : `玩家 ${st.winner} 获胜`}`);
      else printLine(`当前行动方：玩家 ${board.currentPlayer()}`);
      break;
    }
    case 'legal': {
      const moves = parseMoves(rawArgs[0] || '');
      const board = boardFromMoves(moves);
      printLine(`合法列：[${board.legalColumns().join(', ')}]`);
      break;
    }
    case 'analyze': {
      const { depth, budget, rest } = parseFlags(rawArgs);
      const moves = parseMoves(rest[0] || '');
      const game = store.saveGame(moves);
      const board = boardFromMoves(moves);
      const result = searchRoot(board, depth, budget);
      const report = store.saveReport(game.id, result);
      const payload = buildExport(game.moves, report);
      printLine(renderTextReport(payload));
      printLine(`报告 id: ${report.id}`);
      break;
    }
    case 'suggest':
    case 'apply-suggestion': {
      const { depth, budget, rest } = parseFlags(rawArgs);
      const moves = parseMoves(rest[0] || '');
      const board = boardFromMoves(moves);
      const result = searchRoot(board, depth, budget);
      if (board.status().over) throw new Error('局面已终局，无建议落子');
      if (!result.complete || result.bestMove === null) {
        throw new Error('预算耗尽，未产生可靠建议');
      }
      const nextMoves = [...moves, result.bestMove];
      const nextGame = store.saveGame(nextMoves);
      printLine(`建议列：${result.bestMove}（评分 ${result.score}）`);
      printLine(`新局面序列：[${nextMoves.join(', ')}]  id=${nextGame.id}`);
      break;
    }
    case 'verify-pv': {
      const { depth, budget, rest } = parseFlags(rawArgs);
      const moves = parseMoves(rest[0] || '');
      const board = boardFromMoves(moves);
      const result = searchRoot(board, depth, budget);
      const check = verifyPrincipalVariation(board, result.principalVariation);
      printLine(`主变化：[${result.principalVariation.join(', ')}]`);
      printLine(`逐步可执行：[${check.executable.join(', ')}]，末端${check.stopsAtTerminal ? '为终局' : '未终局（到达深度限制）'}`);
      break;
    }
    case 'export': {
      const moves = parseMoves(rawArgs[0] || '');
      const { depth, budget } = parseFlags(rawArgs.slice(1));
      const id = `${gameIdFor(moves)}:d${depth}:b${budget}`;
      const report = store.getReport(id);
      if (!report) throw new Error(`报告不存在：${id}（请先以相同深度与预算分析）`);
      printLine(renderTextReport(buildExport(moves, report)));
      break;
    }
    case 'list': {
      for (const g of store.listGames()) {
        printLine(`${g.id}  ${g.final_status}  [${g.moves.join(', ')}]`);
      }
      break;
    }
    case 'demo':
      demo(store);
      break;
    default:
      printLine(USAGE);
  }
}

function demo(store: Store): void {
  printLine('############ 中文演示 ############');
  const seqA = [0, 1, 0, 1, 0, 2];
  printLine(`\n【演示1】序列 ${JSON.stringify(seqA)} 后，当前方在 0 列立即获胜`);
  const boardA = boardFromMoves(seqA);
  printLine(renderBoard(boardA));
  printLine(`合法列：[${boardA.legalColumns().join(', ')}]；红落 0 列即竖连四获胜`);

  const seqB = [0, 1, 0, 1, 2, 1];
  printLine(`\n【演示2】序列 ${JSON.stringify(seqB)} 后，识别对 1 列的威胁`);
  const boardB = boardFromMoves(seqB);
  printLine(renderBoard(boardB));
  const gameB = store.saveGame(seqB);
  const result = searchRoot(boardB, 4, 200000);
  const report = store.saveReport(gameB.id, result);
  printLine(renderTextReport(buildExport(gameB.moves, report)));

  printLine('\n【演示3】预算不足（深度6、预算仅200节点）');
  const boardC = boardFromMoves([]);
  const limited = searchRoot(boardC, 6, 200);
  printLine(
    `完成=${limited.complete} 已完成根列=[${limited.completedRootColumns.join(', ')}] `
      + `访问节点=${limited.nodes}（未完成时不输出最佳列/最终评分）`
  );
  printLine('\n提示：重新分析请使用 node dist/cli.js analyze <序列> --depth <1-6> --budget <数>');
}

const USAGE = `重力四子棋分析后端 CLI

用法:
  board <列编号逗号分隔>          查看文本棋盘
  legal <序列>                    查看合法列
  save <序列>                     保存合法落子序列到 SQLite
  analyze <序列> [--depth 1-6] [--budget N]   分析并保存报告
  suggest <序列> [--depth ..] [--budget ..]   应用建议生成并保存新局面
  verify-pv <序列> [..]           校验主变化可逐步执行
  export <序列> [--depth ..] [--budget ..]    导出已保存报告
  list                            列出已保存局面
  demo                            运行中文演示

示例:
  node dist/cli.js board 0,1,0,1,0,2
  node dist/cli.js analyze 0,1,0,1,2,1 --depth 4 --budget 200000`;

main();
