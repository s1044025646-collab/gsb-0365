// 报告构建：把局面 + 搜索结果组装成可导出的中文文本/JSON 报告。

import { boardFromMoves, renderBoard, RULES_VERSION } from './rules';
import { ReportRow } from './db';
import { HEURISTIC_DESCRIPTION } from './evaluate';
import { verifyPrincipalVariation } from './search';

export interface ExportPayload {
  rulesVersion: string;
  moves: number[];
  boardText: string;
  report: ReportRow;
  pvVerification: { executable: number[]; stopsAtTerminal: boolean };
  heuristicDescription: string;
  interpretation: string;
}

export function buildExport(moves: number[], report: ReportRow): ExportPayload {
  const board = boardFromMoves(moves);
  const pvVerification = verifyPrincipalVariation(board, report.principal_variation);
  const st = board.status();
  let interpretation: string;
  if (st.over) {
    interpretation = st.draw
      ? '输入局面已终局：平局。只报告终局，不再建议落子。'
      : `输入局面已终局：玩家 ${st.winner} 已获胜。只报告终局，不再建议落子。`;
  } else if (!report.complete) {
    interpretation =
      `节点预算 ${report.budget} 在完成全部根列前耗尽（仅完成列 ${report.completed_root_columns.join(', ')}），`
      + '结果标记为未完成，不能把部分列的最好分当作该深度最终最优。请提高预算后重新分析（将生成新报告）。';
  } else {
    const perspective = `当前行动方为玩家 ${board.currentPlayer()}`;
    const score = report.score!;
    let claim: string;
    if (Math.abs(score) >= 900000) {
      claim =
        score > 0
          ? `在深度 ${report.depth} 内可强制获胜（分数含“越快越好”的步数折扣，并非全局必胜证明）。`
          : `在深度 ${report.depth} 内当前方处于强制失败线（更深搜索可能改变结论）。`;
    } else if (score === 0) {
      claim = '启发式评估为均势或平局线；正分不代表已证明胜利。';
    } else {
      claim = `启发式评分 ${score}，仅表示有限深度内的棋型倾向，不代表已证明胜负。`;
    }
    interpretation = `${perspective}。${claim} 同分按列号从小到大确定选择。`;
  }
  return {
    rulesVersion: RULES_VERSION,
    moves,
    boardText: renderBoard(board),
    report,
    pvVerification,
    heuristicDescription: HEURISTIC_DESCRIPTION,
    interpretation,
  };
}

export function renderTextReport(payload: ExportPayload): string {
  const r = payload.report;
  const lines: string[] = [];
  lines.push('===== 重力四子棋分析报告 =====');
  lines.push(`规则版本: ${payload.rulesVersion}`);
  lines.push(`输入序列: [${payload.moves.join(', ')}]`);
  lines.push('');
  lines.push(payload.boardText);
  lines.push('');
  lines.push(`深度: ${r.depth}    节点预算: ${r.budget}`);
  if (payload.moves.length > 0 && boardFromMoves(payload.moves).status().over) {
    const b = boardFromMoves(payload.moves);
    const s = b.status();
    lines.push(`终局: ${s.draw ? '平局' : `玩家 ${s.winner} 获胜`}（不建议落子）`);
  } else if (!r.complete) {
    lines.push('状态: 未完成（预算耗尽）');
    lines.push(`已完成根列: [${r.completed_root_columns.join(', ')}]`);
  } else {
    lines.push(`状态: 完成`);
    lines.push(`最佳列: ${r.best_move}    评分(当前行动方视角): ${r.score}`);
    lines.push(`主变化: [${r.principal_variation.join(', ')}]`);
    lines.push(`访问节点: ${r.nodes}    alpha-beta 剪枝次数: ${r.cutoffs}`);
    lines.push(
      `主变化校验: 逐步可执行 [${payload.pvVerification.executable.join(', ')}]，`
      + `${payload.pvVerification.stopsAtTerminal ? '末端为终局' : '末端到达深度限制（未终局）'}`
    );
  }
  lines.push('');
  lines.push(`解释: ${payload.interpretation}`);
  lines.push(`启发式: ${payload.heuristicDescription}`);
  return lines.join('\n');
}
