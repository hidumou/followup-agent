# 11 核心交互

每条交互包含：触发、前置条件、步骤、状态变化与写入、异常与边界、CLI 等价、验收点。全局约定：

- 所有写操作经 `core/services`，并写审计日志（谁、何时、做了什么、前后状态）。
- 危险操作二次确认；发送动作幂等（以 draftId 作为幂等键）。
- MVP 逐条处理，不做批量批准；批量操作放入 backlog。

## 草稿状态

`pending_approval → approved → sent | send_failed`
`pending_approval → rejected`
`approved` 可来自「原样批准」或「编辑后批准」（后者写入 `human_edits`）。
`send_failed` 可手动重试，不自动重发。

## I-01 审批草稿
- 触发：`daily-followup` 在审批步骤暂停，草稿进入队列。
- 前置：草稿状态为 `pending_approval` 且护栏全部通过。
- 步骤：
  1. 操作者查看草稿、匿名上下文、护栏结果，可对比原始版本。
  2. 选择：批准 / 编辑后批准 / 拒绝 / 跳过。
  3. 编辑后批准：保存编辑，**重新运行护栏**，通过后才可批准。
  4. 拒绝：必选原因码（`TONE`、`FACT_ERROR`、`FORBIDDEN`、`TOO_LONG`、`NOT_FIT_USER`、`OTHER`），`OTHER` 备注必填。
  5. 批准后恢复 workflow：`SendService` 按 `SEND_MODE` 与白名单处理。
- 状态与写入：状态更新；编辑差异写 `human_edits`；拒绝写 `reject_reason`；记录 playbook 版本；审计日志。
- 异常与边界：
  - 护栏失败：不可批准；只能编辑后重新检查或拒绝。
  - 草稿过期（超过 `DRAFT_TTL_DAYS`，默认 7）：标记 `expired`，需重新生成。
  - 并发处理：以版本号乐观锁，后到者提示「已被处理」。
  - `SEND_MODE=dry-run`：不发送，写入 `out/outbox/`，状态记为 `sent`（带 dry-run 标记）。
  - `live`：收件人不在白名单 → 拒绝发送并报错，状态保持 `approved`。
  - 发送失败：状态 `send_failed`，记录原因，等待手动重试。
- CLI：`pnpm approve`（逐条交互，输入 a / e / r / s）。
- 验收：护栏失败的草稿无法批准；拒绝必须有原因码；重复提交不会重复发送；dry-run 不产生真实邮件。

## I-02 回复入库与复核
- 触发：`reply-ingest` 运行，或手动 `pnpm job:ingest`。
- 步骤：拉取新回复 → 匹配到回访记录 → `redact()` → 抽取 insight → 写入。置信度低于 `LOW_CONFIDENCE`（默认 0.6）或标签为「其他」的标记为待复核。
- 人工复核：确认 / 修正标签（填备注）/ 标记不准确（原因：标签错、漏掉要点、过度解读、其他）。
- 写入：修正写 `insight_overrides`；审计日志。
- 异常与边界：
  - 无法匹配到回访记录：放入「未匹配」列表，不进入模型。
  - 回复中含联系方式：redact 后再处理；原文仅存本地，不进入日志。
  - 重复拉取：以邮件 ID 去重。
- CLI：`pnpm replies -- list --needs-review`、`pnpm replies -- review <id>`。
- 验收：进入模型的回复文本不含邮箱与手机号（有测试）；去重有效；修正被记录。

## I-03 报告生成、确认、反馈
- 触发：`daily-digest` / `weekly-report` 运行。
- 步骤：
  1. 生成报告，按 playbook 报告模板渲染，每个结论附证据数量和链接。
  2. `REPORT_REVIEW_FIRST=true` 时先发给操作者，状态 `待确认`；操作者确认后发送给决策者。否则直接发送。
  3. 阅读者提交反馈：`USEFUL`、`UNCLEAR`、`MISSING_INFO`、`NOT_ACTIONABLE`、`OTHER` + 备注。MVP 由操作者代为录入。
- 写入：报告记录（含 playbook 版本）；反馈写 `report_feedback`。
- 异常与边界：当日无数据 → 生成「无新增」简报，不调用模型；周报生成失败 → 保留日汇总，提醒操作者重试。
- CLI：`pnpm report -- show weekly`、`report -- send <id>`、`report -- feedback <id>`。
- 验收：每条结论可追溯到证据；未确认的周报不会发送给决策者（审阅模式下）。

## I-04 Playbook 建议的审阅（M6）
- 触发：`playbook:propose` 产出状态为 `ready` 的 proposal。
- 步骤：
  1. 操作者打开建议，查看结论、diff、理由、证据、回归结果、可能副作用。
  2. 决定：
     - 采纳：创建新版本，写 CHANGELOG 与快照。
     - 修改后采纳：就地编辑 diff → 自动重新回归 → 结果出来后再确认。
     - 拒绝：选择原因（证据不足、不是规律、副作用过大、其他），用于去重。
     - 搁置：设定 N 周后再次出现于待审阅。
  3. 采纳后新版本从下一次运行起生效，并开始观察期。
- 写入：proposal 状态与决定；`playbook_versions`；审计日志。
- 异常与边界：
  - 回归显示「不建议采纳」：仍可采纳，但需勾选「我已了解回归结果」并填写理由。
  - 基础版本已变化（审阅期间有人改了 playbook）：proposal 标为 `expired`，需重新生成。
  - 同时有多条 proposal 触及同一文件：逐条处理，每次采纳后其余基于旧版本的 proposal 自动重新校验。
- CLI：`pnpm playbook:review`。
- 验收：不存在 AI 直接写入 playbook 的路径；每个版本可追溯到 proposal 或手动修改。

## I-05 Playbook 手动编辑与回滚
- 手动编辑：保存时必须填写变更说明，生成新版本，来源标记 `manual`。直接改文件后启动，系统检测差异并自动生成 `manual` 版本，同时要求补充说明。
- 回滚：选择旧版本 → 确认「将以该版本内容创建新版本」→ 填写原因 → 新版本生效。不删除历史。
- 受限范围：控制台编辑器对 🔒 文件同样可编辑（操作者有权限），但会提示这些内容属于安全边界，并要求二次确认。
- CLI：`pnpm playbook -- rollback <version>`。
- 验收：回滚后历史记录仍显示各自生成时的版本号。

## I-06 预算与上限触发
- 触发：任一上限被触及（`MAX_USERS_PER_RUN`、`MAX_LLM_CALLS_PER_RUN`、`DAILY_TOKEN_BUDGET`）。
- 行为：
  - 用户数上限：截断名单，其余用户留待下次，写入日志。
  - 调用或 token 上限：立即中止本次运行，已完成的结果保留，运行状态为 `aborted_budget`。
  - 向操作者发一封提醒邮件。
- 边界：不提供界面上的「临时放宽」；如需调整，修改 `.env` 并重启。
- 验收：触及上限后不再产生任何模型调用（有测试）。

## I-07 失败与重试
- 已确认覆盖策略：模型或外部 API 调用失败立即停止当前运行，标记 `failed` 并记录原因；不自动重试、不继续处理其他用户。取消或进程重启中断也等待人工重试。
- 发送失败：不自动重发。
- 重试入口：`pnpm runs -- retry <runId>` 或 `approve` 队列里的失败项。
- 验收：失败后无额外模型调用；已完成结果保留；人工重试跳过已保存草稿与发送凭据，不产生重复发送。

## I-08 发送模式保护
- 发送模式只能通过 `.env` 修改并重启，界面不提供切换。
- 顶栏常显模式；live 阶段先使用白名单（`SEND_ALLOWLIST`），确认无误再放开。
- 验收：未设置 `SEND_MODE=live` 时任何路径都不会真实发送。

## 审计日志字段（概要）
时间、操作者、动作、对象类型与 ID、变更前后摘要、playbook 版本、运行 ID。
