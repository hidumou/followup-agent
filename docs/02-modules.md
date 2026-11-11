# 02 模块划分

## 模块总览

| 模块 | 位置 | 职责 | 依赖 |
|---|---|---|---|
| domain | `src/core/domain` | 类型与状态枚举 | 无 |
| ports | `src/core/ports` | 外部能力的接口定义 | domain |
| privacy | `src/core/privacy` | 匿名化、`redact()` | domain |
| guards | `src/core/guards` | 草稿的确定性规则检查 | domain |
| playbook | `src/core/playbook` | 加载 playbook 与标签 | 无 |
| send-service | `src/core/send` | 审批后发送，唯一获取联系方式的地方 | ports |
| adapters | `src/adapters/*` | 端口的具体实现 | ports |
| mastra | `src/mastra` | agents、tools、workflows、scorers、Mastra 实例 | core |
| cli | `src/cli` | 命令入口，供 cron 与人工调用 | mastra, runtime |
| runtime | `src/runtime` | 环境变量校验、依赖装配（选哪套 adapter 与 playbook） | 全部 |

## 端口（接口草案，字段细节在实现时再定）

```ts
interface UserSource {
  listChurned(opts: { since?: Date; limit: number }): Promise<UserRef[]>;
  getContext(userId: string): Promise<UserContext>;   // 匿名特征，可进入模型
  getContact(userId: string): Promise<Contact>;       // 仅 SendService 可调用
}

interface Mailer {
  send(msg: OutboundMessage): Promise<{ messageId: string }>;
  listReplies(opts: { since: Date }): Promise<InboundReply[]>;
}

interface RecordStore {
  // followups, drafts, replies, insights, runs, human_edits
  // 外加按时间范围聚合查询，供日汇总和周报工具使用
}

interface Notifier {
  deliver(report: { title: string; markdown: string }, recipients: string[]): Promise<void>;
}
```

说明：`UserContext` 与 `Insight` 的详细字段由 playbook 定义，MVP 先用宽松结构（`features: Record<string, unknown>`、`tags: string[]`、`evidence: string[]` 等），不要在 core 里写死业务字段。

## Workflows

**daily-followup**：fetchChurned → excludeContacted → capByLimit → forEach(user)：buildContext → classify → draftEmail → guardCheck → saveDraft(`pending_approval`) → suspend(等待审批) → sendApproved → record。

**reply-ingest**：listReplies → matchToFollowup → redact → extractInsight → saveInsight → 更新状态为 `analyzed`。

**daily-digest**：aggregateToday（纯代码）→ renderDigest（可选一次 LLM 润色）→ Notifier。

**weekly-report**（agent）：只读工具 `queryRecords`、`getAggregates`、`getInsights`；输出按 playbook 报告模板；可配置为先发给你审阅。

## Agents
- `classifyAgent`：小模型，输出标签（结构化输出，标签集来自 playbook）。
- `draftAgent`：较好的模型，按 playbook 写回访草稿。
- `extractAgent`：小模型，从已脱敏回复中抽取结构化 insight。
- `insightAgent`：周报自主分析，唯一允许多步自主调用工具的 agent。

模型按任务从环境变量取（`MODEL_FAST`、`MODEL_WRITER`、`MODEL_REPORT`），通过 Mastra 模型路由接入，便于切换厂商。

## 状态机（FollowupRecord）

`discovered → drafted → pending_approval → approved | rejected → sent → replied → analyzed`
任一步失败进入 `failed`（记录原因，可重试）。`rejected` 与人工编辑差异写入 `human_edits`，作为评估数据。

## 护栏（guards，确定性代码）
- 草稿长度范围、必须包含退订说明（如 playbook 要求）、禁止承诺清单（来自 playbook 禁区）。
- 草稿中不得出现邮箱、手机号等 PII 模式。
- 任何一项失败 → 草稿不进入审批队列，标记 `failed` 并记录原因。

## 评估与可观测
- 在线：每次人工审批记录「草稿 vs 最终版」差异与是否被拒；记录结论被推翻的情况。
- 离线：`pnpm eval` 对 fixtures 运行 scorers（MVP 最少 2 个：护栏通过率、抽取结果结构有效率）。
- 追踪：使用 Mastra 的追踪与 Studio；每次运行记录模型调用次数与 token 用量。

## 新增模块（控制台与 playbook 演进）

| 模块 | 位置 | 职责 | 里程碑 |
|---|---|---|---|
| services | `src/core/services` | ApprovalService、ReviewService、ReportService、PlaybookService、ProposalService；CLI 与控制台共用，所有写操作写审计日志 | M0 起逐步建立（先读后写） |
| versioning | `src/core/evolution/versioning` | playbook 版本快照、手动修改检测、回滚 | M1 |
| signals | `src/core/evolution/signals` | 采集编辑差异、拒绝原因、insight 修正、报告反馈 | M2 到 M4 |
| proposal 校验 | `src/core/evolution/proposal` | 范围与大小校验、去重、冲突标注 | M6 |
| regression | `src/core/evolution/regression` | 用候选版本跑 dry-run 并生成对比报告 | M6 |
| playbook-proposer | `src/mastra/agents/playbook-proposer.ts` | 离线 agent，只读信号，通过 `submitProposal` 工具提交建议 | M6 |
| playbook-proposal workflow | `src/mastra/workflows/playbook-proposal.ts` | 取数、归因、生成、校验、回归、入库 | M6 |
| console | `src/console` | 本机网页控制台（server 与 web），只调用 services，遵循 `12` 的设计规范 | M0 起逐步建设，M5 验收 |

## 新增领域对象
`RejectReason`（`TONE`、`FACT_ERROR`、`FORBIDDEN`、`TOO_LONG`、`NOT_FIT_USER`、`OTHER`）、`HumanEdit`、`InsightOverride`、`ReportFeedback`、`PlaybookVersion`、`PlaybookProposal`、`ProposalEvidence`、`RegressionReport`、`AuditLogEntry`、`Run`。字段在实现时按 `08`、`11` 的描述确定。
