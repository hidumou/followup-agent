# 05 运行部署与成本

## 阶段一：本机运行（MVP 采用）
- 触发：cron（Linux）或 launchd（macOS），分别调用 `pnpm job:daily` 与 `pnpm job:weekly`。
- 存储：本地 SQLite 文件，位于 `data/`。
- 审批：本地 UI（`pnpm dev:ui`）或命令行 `pnpm approve`。
- 回复接收：每次运行时轮询 Resend 的接收接口，不依赖 webhook。
- 风险：本机休眠或关机会漏跑。对策：`job:catchup` 在启动时检查上次成功运行时间并补跑；日志写入 `logs/`。
- 密钥：`.env` 权限设为仅本人可读，不入库。

cron 示例（路径自行替换）：
```
0 9 * * *  cd /path/to/followup-agent && pnpm job:daily  >> logs/daily.log 2>&1
0 9 * * 1  cd /path/to/followup-agent && pnpm job:weekly >> logs/weekly.log 2>&1
```

## 阶段二：迁移到 Cloudflare（MVP 之后，非必须）
触发条件：本机常开不可靠，或需要远程访问网页审批。
- 定时：Workers Cron Trigger；审批页与周报页放在你的域名上，用 Cloudflare Access 限制访问；存储改 D1 或 KV。
- 邮件仍用 Resend：Cloudflare 的邮件发送目前为 Beta 且需要 Workers 付费计划，免费账号只能用其 Email Routing 收信。
- 免费计划需核实的限制（各来源描述不完全一致，以官方文档为准）：每日请求数上限、单次调用 CPU 时间、单次调用子请求数（约 50）、每个 Worker 的 Cron Trigger 数量。一次处理多个用户容易超过子请求上限，需要按用户拆分调用。
- Mastra 官网称有 Cloudflare 部署器，迁移前先读其文档确认。

## 成本估算

主要成本是模型 token，其余基本为零。

| 项目 | 阶段一 | 说明 |
|---|---|---|
| 模型 API | 见下方估算 | 唯一有意义的成本 |
| Resend | 以官网当前套餐为准 | 回访量很小，通常在免费额度内，请核实 |
| Cloudflare | 0 | 免费账号，阶段二才使用 |
| 本机 | 0 | 需保证运行时在线 |
| 域名 | 已有 | 用子域名发信 |

### 模型成本粗估（假设，需用真实数据校正）
- 假设：每天 10 个用户，每个用户 3 次模型调用（分类、写草稿、抽取回复），每次平均输入 2,000 token、输出 500 token；周报每周约 5 万输入、1 万输出 token。
- 月用量约：输入 2.0M token，输出 0.5M token。
- 以 Mastra 模型列表中的火山引擎价格举例（每百万 token，输入/输出）：小模型 0.03/0.30 美元 → 约 0.2 美元/月；较强模型 0.89/4 美元 → 约 3.8 美元/月。价格以服务商当前报价为准。
- 结论：每月在几美分到几美元量级。OpenAI 模型请代入所选型号的价格重算。

### 成本控制规则（实现时必须有）
- `MAX_USERS_PER_RUN`、`MAX_LLM_CALLS_PER_RUN`、`DAILY_TOKEN_BUDGET`，超限中止。
- 本轮分类与写稿先统一使用 GPT-6 Luna；回复抽取和周报到对应里程碑再用样例评估模型。
- 日汇总基于结构化记录用代码聚合，不重读原始回复。
- 每次运行记录调用次数与 token，写入运行日志。
- 在模型服务商控制台同时设置额度上限。

## 当前实现的模型预算

标准单价与配置见 `10-ai-integration.md`。`LLM_BUDGET_USD` 限制当前数据库全部运行的累计估算费用（含未知用量预留），默认 0；日 token 预算按 `BUDGET_TIMEZONE` 的调用日期统计。不能覆盖其他应用或数据库的消费，也不能代替供应商账单或控制台设置。
