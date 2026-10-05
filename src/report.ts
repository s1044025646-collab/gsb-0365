// 报告与棋盘展示（API 与 CLI 共用）

import { Board } from "./rules";
import { AnalysisResult, verifyPv } from "./search";
import { AnalysisRow } from "./db";

export function boardView(board: Board) {
  const s = board.status;
  return {
    board: board.toString(),
    sideToMove: s.kind === "ongoing" ? board.sideToMove() : null,
    status:
      s.kind === "win"
        ? `玩家 ${s.winner} 获胜（连线：${s.line.map(([c, r]) => `(${c},${r})`).join(" ")}）`
        : s.kind === "draw"
          ? "平局（棋盘已满）"
          : "进行中",
    legalColumns: board.legalColumns(),
    moveCount: board.moveCount,
  };
}

export function analysisReport(board: Board, row: AnalysisRow): string {
  const r: AnalysisResult = row.result;
  const lines: string[] = [];
  lines.push(`分析报告 #${row.id}（局面 #${row.gameId}）`);
  lines.push(`创建时间：${row.createdAt}`);
  lines.push(`搜索深度：${r.depth}，节点预算：${r.nodeBudget}`);
  lines.push(`访问节点：${r.nodes}，剪枝次数：${r.prunes}`);
  if (r.terminal) {
    lines.push(r.terminal.kind === "win" ? `局面已终局：玩家 ${r.terminal.winner} 已获胜，不再建议落子。` : "局面已终局：平局，不再建议落子。");
    return lines.join("\n");
  }
  if (!r.completed) {
    lines.push("结果未完成：节点预算耗尽，未探索全部候选，");
    lines.push("因此不给出该深度的最优列与评分（部分探索的最好分不代表最终最优）。");
    lines.push("请增大节点预算或降低深度后重新分析（将生成新报告）。");
    return lines.join("\n");
  }
  const pvCheck = verifyPv(board, r.pv);
  lines.push(`最佳列：${r.bestColumn}（同分时取编号最小的列）`);
  lines.push(`评分：${r.score}（当前行动方视角；正分仅为启发式优势，不代表已证明必胜）`);
  lines.push(`主变化：${r.pv.join(" -> ")}`);
  lines.push(`主变化校验：逐步执行 ${pvCheck.applied.length} 步全部合法` + (pvCheck.terminal ? `，终局：${pvCheck.terminal}` : "，未终局"));
  lines.push(`剪枝依据：共 ${r.prunes} 次 beta 截断，被跳过的列不可能改变已确定的下界。`);
  return lines.join("\n");
}
