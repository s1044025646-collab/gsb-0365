# 重力四子棋（Connect Four）有限深度分析后端

只做 **API 与 CLI** 的本地后端：标准 7 列 × 6 行重力四子棋局面构造、规则校验、
自行实现的 **negamax + alpha–beta 剪枝** 有限深度搜索（深度 1–6）、主变化解释与
SQLite 持久化。无图形界面、无联网对战、无账户、无外部引擎或模型服务。

- 语言/运行时：TypeScript + Node.js（内置 `node:sqlite`，**无需编译原生模块**）
- 平台：Windows 本地 PowerShell，不依赖 Docker / WSL / 付费服务 / 在线 API
- 要求：Node.js ≥ 22（本项目在 Node 25 上实测；`node:sqlite` 在旧版本可能需要 22.5+）

## 快速开始

```powershell
npm install        # 仅安装 typescript 与类型声明
npm run build      # 编译到 dist/
npm test           # 构建并运行 13 个测试
npm run demo       # 中文 CLI 演示
npm start          # 启动 HTTP API（默认自动选择空闲端口，看控制台输出）
```

指定端口或数据目录：

```powershell
$env:PORT="8080"; npm start
$env:C4_DATA_DIR="E:\GSB\0365\A\data"; npm start
```

数据默认保存在项目内 `data/connect4.sqlite`。

## 坐标与表示

- 列编号 `0..6`（从左到右），行编号 `0..5`（**row 0 为最底行**，row 5 为最顶行）。
- 落子序列即从空棋盘开始的列编号数组，如 `[0,1,0,1,0,2]`。
- 玩家 `1` 红/X 先手，玩家 `2` 黄/O 后手，交替落子；棋子落在该列最低空格。
- 水平、竖直或两条斜线出现连续 4 枚同色棋子即获胜；棋盘 42 格填满无人获胜为平局。
- 文本棋盘示例：

```text
|. . . . . . .|  row 5
|. O . . . . .|  row 2
|X O . . . . .|  row 1
|X O X . . . .|  row 0
 0 1 2 3 4 5 6  col
 X=红(先手1)  O=黄(后手2)  .=空
```

## 搜索与评分（实现说明）

搜索代码：`src/core/search.ts`；规则：`src/core/rules.ts`；启发式：`src/core/evaluate.ts`。

### 算法

- **negamax**：每个节点都从“当前行动方”角度评分，子节点分数取负，胜负符号随行动方自动转换。
- **alpha–beta 剪枝**：根节点与内部节点统一窗口；固定按列号 `0→6` 枚举，
  仅在分数 **严格更大** 时更新最佳列，因此同分时确定地选择最小列号。
- **撤销落子**：每次递归用 `try/finally` 保证 `board.undo()` 被调用，
  撤销恢复棋盘格、列高和终局标记，不污染下一个候选。
- **深度范围 1–6**；终局分数 `WIN=1,000,000`，永远压过启发式分数。
- **越快获胜越好**：胜/负分数为 `±(WIN - 终局已走步数)`，同一方更快的胜利分数更高；
  失败同理（更晚输分数更高）。平局为 `0`。
- **节点预算**：每访问一个节点计数，超过预算立即抛出 `BudgetExhausted`，
  结果标记 `complete=false`，不返回最佳列/最终评分，并报告已完成的根列，
  绝不把“只搜了部分列的最好分”冒充该深度最终最优。

### 深度限制处的启发式（非终局）

公开的简单棋型评估，枚举棋盘全部 **69 个长度为 4 的窗口**
（水平 24、竖直 21、两条斜线各 12）：

- 窗口只含己方棋子：1/2/3 枚分别计 `+1/+10/+50`；
- 只含对方棋子：取负；混有双方棋子或全空：`0`；
- 另对中心列（列 3）每枚棋子加 `±3` 的轻微占位奖励（中心列参与的四连窗口最多，
  该奖励左右镜像对称，**不是用固定列代替搜索**）。

启发式只表示棋型潜力。报告中 `|score| >= 900000` 才解读为“在本深度内可强制获胜/失败”，
且措辞明确：**有限深度最优不等于全局必胜，正的启发式分不是胜利证明**。

### 输出字段

分析返回：最佳合法列 `bestMove`、深度、评分（当前行动方视角）、
主变化 `principalVariation`、访问节点数 `nodes`、剪枝次数 `cutoffs`、预算与完成状态。
主变化在保存/导出前用真实规则副本逐步重放校验，遇终局停止。

### 无剪枝基准（手工核验）

`src/core/minimax-baseline.ts` 是独立实现的朴素 negamax（无 alpha-beta、不共享搜索路径），
枚举全部根候选给出精确分。测试在多个局面、深度 1–3 上核对：
alpha-beta 的评分等于基准、最佳列属于基准的“全部同分最优列集合”。

## 手工核验方法

```powershell
# 立即获胜：第 7 手红在列 0 竖连四
node dist/cli.js board 0,1,0,1,0,2
node dist/cli.js legal 0,1,0,1,0,2

# 对手威胁：黄列1竖三，深度2必须挡列1；深度1看不到终局
node dist/cli.js analyze 0,1,0,1,2,1 --depth 1
node dist/cli.js analyze 0,1,0,1,2,1 --depth 4

# 校验主变化逐步合法、应用建议生成新局面、导出已保存报告
node dist/cli.js verify-pv 0,1,0,1,2,1 --depth 4
node dist/cli.js suggest 0,1,0,1,2,1 --depth 4
node dist/cli.js export 0,1,0,1,2,1 --depth 4 --budget 200000
```

## CLI 命令

| 命令 | 说明 |
| --- | --- |
| `save <序列>` | 保存合法落子序列（非法则报错，不留半局） |
| `board <序列>` | 打印文本棋盘、当前行动方或终局 |
| `legal <序列>` | 打印合法列 |
| `analyze <序列> [--depth 1-6] [--budget N]` | 分析、保存局面与报告并打印解释 |
| `suggest <序列> [...]` | 应用建议列，生成并保存新局面 |
| `verify-pv <序列> [...]` | 逐步重放主变化验证合法性 |
| `export <序列> [--depth ..] [--budget ..]` | 导出已保存的中文报告 |
| `list` | 列出已保存局面 |
| `demo` | 运行中文演示（含预算不足示例） |

## HTTP API

请求/响应均为 JSON（`Content-Type: application/json`）。序列字段为 `moves`。

| 方法 路径 | 说明 |
| --- | --- |
| `POST /games` | 保存合法序列（幂等：相同序列同一 id） |
| `GET /games`、`GET /games/:id` | 列出/查询旧局面 |
| `POST /board` | 文本棋盘、当前行动方、合法列、终局状态 |
| `POST /legal` | 合法列 |
| `POST /analyze` | 分析并保存报告；body：`moves, depth?, budget?` |
| `POST /apply-suggestion` | 应用建议列，保存新局面 |
| `POST /verify-pv` | 主变化逐步校验 |
| `GET /reports?gameId=`、`GET /reports/:id` | 查询旧报告（深度与预算固定在报告中） |
| `GET /reports/:id/export?format=text` | 导出中文文本报告（默认 JSON） |
| `GET /health` | 健康检查 |

curl 示例（PowerShell）：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:<端口>/analyze -Method Post `
  -ContentType 'application/json' `
  -Body '{"moves":[0,1,0,1,2,1],"depth":4,"budget":200000}'
```

### 参数限制与错误码

- 序列长度 0–42，元素必须为整数列号；深度 1–6；预算 1–2,000,000。
- `COLUMN_OUT_OF_RANGE`（422）：列号非 0–6 整数
- `COLUMN_FULL`（422）：列已满
- `GAME_ALREADY_OVER`（422/409）：胜负已分或平局后继续落子 / 对终局局面求建议
- `INVALID_MOVES`（400）：序列类型/长度非法
- `INVALID_DEPTH` / `INVALID_BUDGET`（400）：深度或预算越界
- `BUDGET_EXHAUSTED`（409，仅建议接口）：预算耗尽未产生可靠建议；分析接口返回 `complete=false`
- `GAME_NOT_FOUND` / `REPORT_NOT_FOUND`（404）

## 持久化

SQLite 两张表：`games`（序列、规则版本 `standard-7x6-v1`、步数、终局状态）与
`reports`（深度、预算、完成状态、最佳列、评分、主变化、节点数、剪枝数）。
写库前先用规则完整验证序列，事务提交；非法输入不产生任何记录（不留半局）。
修改深度或预算会生成不同报告 id（`<局面id>:d<深度>:b<预算>`），旧局面旧报告长期可查询。
重启服务后用同一序列可再次分析或导出。

## 已知限制与合理假设

- 同步计算，无后台作业/断点恢复；预算与深度有硬上限以防失控。
- 不使用开局库、置换表或完整求解；不保证全局最优/必胜。
- 不保存整棵搜索树，也不提供所有根候选的精确分（需要时可用基准模块另行核算）。
- `node:sqlite` 在当前 Node 版本会打印一条 ExperimentalWarning，不影响功能。
