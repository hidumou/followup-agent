# 07 MVP 边界与里程碑

## 目标
1. 跑通闭环：流失名单 → 草稿 → 审批 → 发送 → 回复入库 → 日汇总与周报。
2. 学习并验证 Mastra：agent、workflow、暂停恢复、存储与记忆、评估、追踪、模型路由，各自在项目里有明确落点。
3. 证明通用性：换适配器与 playbook，不改 `core/`。

## 范围内
- 单一用户平台、单一邮件渠道（Resend）、单一语言。
- 命令行审批；本机定时运行。
- 结构化记录与基础评估数据（人工编辑差异、2 个 scorers）。
- 日汇总与周报，面向决策者。

## 范围外（写入 `docs/backlog.md`，不要实现）
- 网页审批界面或后台管理
- 实时事件触发（用户一回复立刻处理）与 webhook
- 多渠道（站内信、IM、电话）
- 向量记忆、语义检索
- 自动对接 bug 队列、SEO 流程
- Cloudflare 部署（阶段二）
- 多租户、权限体系
- 复杂归因分析、A/B 测试
- 无审批的自动发送

## 里程碑与验收

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| M0 骨架与 mock | 脚手架、ports、mock 适配器、SQLite、`daily-followup` 在 dry-run 下跑通（可用 stub 模型） | `npm run job:daily` 在 mock 下生成草稿到 `out/`；两套 playbook（`demo`、`demo-alt`）都能跑，且不改 `core/`；typecheck 与测试通过 |
| M1 真实数据与模型 | HTTP 用户适配器、真实模型、隐私与护栏、运行上限、成本统计 | 真实名单进入流程，dry-run 产出草稿；确认模型不接触联系方式（有单测）；超限会中止；模型工具调用与结构化输出稳定性有实测结论 |
| M2 审批与发送 | workflow 暂停与恢复、`approve` CLI、SendService、ResendMailer、人工编辑差异记录 | 草稿经审批后才能发送；live 仅对 `SEND_ALLOWLIST` 内邮箱生效；拒绝与编辑都被记录 |
| M3 回复入库 | 轮询 Resend 接收、匹配、`redact()`、抽取 insight | 给自己的邮箱回复一封，能被匹配并生成结构化记录；原文中的 PII 不进入模型 |
| M4 汇总与周报 | `daily-digest`、`weekly-report agent`、Notifier、2 个 scorers、`eval` 命令 | 日汇总与周报能发给指定收件人；周报按模板输出且引用证据；`npm run eval` 可运行 |

MVP 完成 = M0 到 M4 全部通过人工验收。

## 学习目标验收
完成后你应当能说明下列框架能力在本项目中的位置：

| 框架能力 | 本项目落点 |
|---|---|
| Agent 循环 | `insightAgent`（周报） |
| Workflow 编排 | `daily-followup`、`reply-ingest`、`daily-digest` |
| 审批暂停与恢复 | `daily-followup` 的审批步骤 |
| 工具与 MCP | insight agent 的只读工具 |
| 模型路由 | 三档模型配置，OpenAI 与火山引擎切换 |
| 存储与记忆 | workflow 状态与记录库 |
| 评估打分 | `scorers/` 与 `npm run eval` |
| 追踪与 Studio | 每次运行的调用链与 token 用量 |

## 主要风险
- 公司对用户数据给第三方模型的规定未确认：M2 前必须明确，否则保持 dry-run。
- 本机不在线导致漏跑：用 `job:catchup` 缓解。
- 模型工具调用或结构化输出不稳定：M1 实测，必要时换模型。
- 评估信号弱：靠人工编辑差异与抽查积累，不追求自动判定。
