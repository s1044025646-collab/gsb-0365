# 重力四子棋局面分析后端

标准 7 列 6 行重力四子棋（Connect Four）的**有限深度落子搜索与主变化解释**后端。
纯本地运行：TypeScript + Node.js（≥ 22，内置 `node:sqlite`，零运行时依赖），只做 API 与 CLI，
无图形界面、无联网对战、无外部引擎或模型服务。

## 快速开始（Windows / PowerShell）

```powershell
npm install        # 仅安装开发依赖 typescript / @types/node
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试（node:test）
npm run demo       # 内置演示：两个经典局面
npm start          # 启动 API，默认自动选择空闲端口
npm start -- --port=8080   # 或指定端口（也可用 PORT 环境变量）
```

数据保存在项目内 `data/connect4.db`，服务重启后同一局面可再次分析。

## 坐标与规则

- 列编号 `0..6` 从左到右；行 `0..5` 从底到顶（内部表示，文本棋盘顶行在上）。
- 棋子：`X` = 先手（玩家 1），`O` = 后手（玩家 2），`.` = 空。
- 双方交替落子，棋子落在该列最低空格；水平、竖直、两种斜线任意方向连续四子获胜；满盘无胜为平局。
- 局面由从空棋盘开始的列编号序列构造，逐步验证：满列（`COLUMN_FULL`）、越界（`COLUMN_OUT_OF_RANGE`）、
  终局后继续落子（`GAME_ALREADY_OVER`）都会被拒绝；失败输入整体不写入数据库。

## 搜索与评分

- **算法**：自行实现的 negamax + alpha–beta 剪枝，始终从当前行动方视角评分；深度 1–6。
- **终局分**：胜 = `±(1_000_000 + 剩余深度)`，压过一切启发式分；剩余深度计入使**更快获胜得分更高**；
  平局为 0；符号随行动方正确转换。
- **启发式**（仅用于到达深度限制的非终局叶节点，见 `src/evaluate.ts`）：
  - 全部 69 个长度 4 窗口（横、竖、两种斜线）：我方 3 子 1 空 +50，2 子 2 空 +10，1 子 3 空 +1；
    对方棋型按对称分值扣分（因此对手的一步胜威胁被显著惩罚）；双方都有子的窗口不计分。
  - 中列（列 3）每枚我方棋子 +3、对方 -3（中列参与的四连窗口最多）。
- **同分处理**：列按 `0..6` 升序枚举，仅在严格更优时替换，故同分取编号最小的列；
  相同局面与配置必得相同结果（无随机、无置换表、无开局库）。
- **重要限制**：有限深度下的最优**不等于**全局必胜；报告中的启发式正分只表示估计优势，不表示已证明获胜。
  已终局的输入只报告终局，不再建议落子。
- **节点预算**：默认 200 000，上限 2 000 000。预算耗尽时报告 `completed: false`，
  **不给出**最优列与分数（部分探索的最好分不代表该深度最终最优），需增大预算或降低深度重新分析（生成新报告）。
- **主变化（PV）**：随搜索返回，可用真实规则逐步执行，遇终局停止；搜索内撤销落子会完整恢复棋盘与列高。

## CLI 用法

```powershell
node dist/cli.js create 0 1 0 1 0 2      # 保存落子序列，输出局面 id 与文本棋盘
node dist/cli.js board 1                 # 查看局面 #1 的文本棋盘
node dist/cli.js legal 1                 # 查看合法列
node dist/cli.js analyze 1 --depth 4 --budget 200000
node dist/cli.js apply 1 1               # 应用分析 #1 的建议，生成新局面
node dist/cli.js report 1                # 查看分析报告（含主变化校验）
node dist/cli.js serve --port 8080       # 启动 API
node dist/cli.js demo                    # 内置演示
```

## HTTP API

统一错误格式：`{ "error": { "code", "message" } }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/games` | 保存落子序列，body `{ "moves": [0,1,0,1,0,2] }` |
| GET | `/games/:id` | 查看棋盘（文本）、状态、合法列 |
| GET | `/games/:id/legal` | 合法列列表 |
| POST | `/games/:id/analyze` | 分析，body `{ "depth": 1-6, "nodeBudget": N }`（均可选） |
| POST | `/games/:id/apply` | 应用建议生成新局面，body `{ "analysisId": N }` |
| GET | `/analyses/:id` | 分析报告（JSON，含最佳列/评分/主变化/节点数/剪枝数） |
| GET | `/analyses/:id/export` | 中文文本报告（含主变化逐步校验） |

示例（PowerShell）：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/games -ContentType 'application/json' -Body '{"moves":[0,1,0,1,0,2]}'
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/games/1/analyze -ContentType 'application/json' -Body '{"depth":4}'
```

错误码：`COLUMN_OUT_OF_RANGE`、`COLUMN_FULL`、`GAME_ALREADY_OVER`、`INVALID_MOVE_TYPE`（422）；
`INVALID_DEPTH`、`INVALID_NODE_BUDGET`、`BAD_JSON`、`BAD_ID`（400）；`GAME_NOT_FOUND`、`ANALYSIS_NOT_FOUND`（404）；
`NO_SUGGESTION`（409）；`PAYLOAD_TOO_LARGE`（413）。

## 持久化

SQLite（`node:sqlite`）两张表：`games`（落子序列 + 规则版本 `connect4-v1` + 创建时间）、
`analyses`（局面 id + 深度 + 节点预算 + 完成标志 + 完整结果 JSON）。
深度与预算固定于分析记录，修改参数会创建新报告；旧局面与旧报告始终可查询。

## 手工核验方法

1. `npm run demo` 查看两个演示局面的文本棋盘与报告：
   - 序列 `0 1 0 1 0 2`：X 在列 0 已三子，当前方（X）落列 0 立即竖四获胜，分析应给出列 0 与终局级分数。
   - 序列 `0 1 0 1 2 1`：O 在列 1 已三子，深度 ≥ 2 的分析应选择列 1 堵住对手。
2. 对照文本棋盘手工摆子验证主变化：报告中“主变化校验”已在真实规则下逐步执行并报告终局。
3. 测试 `src/test/search.test.ts` 中“与无剪枝 minimax 基准核对”：对多个局面与深度 1–3，
   用**不剪枝的独立 minimax** 计算每个根候选的精确分值，核对 alpha–beta 的评分与最优候选集合一致，
   且同分按列升序取最小——不只检查返回列合法。
4. 其他测试覆盖：满列、斜线胜利、终局后输入、落子撤销恢复、镜像局面评分对应、
   深度一与二的区别、预算不足报告未完成、失败输入不留半局。

## 目录结构

```
src/rules.ts      棋盘、落子、胜负判定、撤销、序列构造
src/evaluate.ts   公开启发式评分
src/search.ts     negamax + alpha-beta、节点预算、PV、无剪枝基准
src/db.ts         SQLite 持久化
src/server.ts     HTTP API
src/cli.ts        命令行与演示
src/report.ts     文本棋盘与中文报告
src/test/         node:test 测试
```

## 限制

- 同步计算，无后台作业；单次分析受节点预算上限约束（深度 6 通常足够快）。
- 未解出整个游戏；不保证全局最优，仅保证给定深度与预算内与基准 minimax 一致。
- 报告只展示最佳线路与剪枝计数，不保存完整搜索树，也不给出所有根候选的精确分值。
