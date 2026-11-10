# AGENTS.md：编码 agent 工作规则

项目：followup-agent（用户回访与总结 Agent，MVP）。先读 `README.md` 和 `docs/` 全部文档，再动手。

## 语言约定
- 代码、注释、提交信息用英文；文档和与用户的沟通用中文。

## 硬性规则（不可违反）
1. 默认 `SEND_MODE=dry-run`。只有同时满足 `SEND_MODE=live`、草稿状态为 `approved`、收件人在 `SEND_ALLOWLIST`（M2 阶段）时才允许真实发送邮件。
2. 禁止把真实用户数据、API key、token 写进代码、fixtures、日志、测试快照或提交。密钥只从环境变量读取，`.env` 必须在 `.gitignore`。
3. 隐私边界：模型（LLM）只能看到匿名上下文（opaque userId、行为特征）。邮箱、姓名等联系方式只能在 `SendService` 发送时通过 `UserSource.getContact()` 临时获取，不得进入任何 prompt、日志或 agent 工具返回值。用户回复文本送入模型前必须经过 `redact()`。
4. 端口与适配器：`src/core` 不得依赖任何具体平台或第三方 SDK。平台细节只能出现在 `src/adapters/*`。判断标准：换平台或换业务，只改 `adapters/` 和 `playbooks/`，不改 `core/`。
5. 业务规则（话术、标签、禁区、报告结构）放 `playbooks/<name>/`，不写死在代码里。
6. 框架 API 不要凭记忆写。Mastra 的用法以当前官方文档为准（https://mastra.ai/docs ，文档索引 https://mastra.ai/llms.txt ）。新建项目可参考官方命令 `npm create mastra@latest`，如参数有变以文档为准。
7. 每次运行必须有上限：`MAX_USERS_PER_RUN`、`MAX_LLM_CALLS_PER_RUN`，超限立即中止并记录，不得继续调用模型。

## 工作方式
- 一次只做一个里程碑（见 `docs/07-mvp-scope.md`），完成后运行测试、汇报、停下，等待人工确认。
- 遇到文档未覆盖的决定，先列出选项和你的推荐，再问用户；不要自行扩大范围。
- 超出 MVP 边界的想法记录到 `docs/backlog.md`，不要实现。
- 小步提交；每个里程碑结束时 `npm run typecheck && npm test` 必须通过。
- 隐私与护栏相关代码（`privacy/`、`guards/`）必须有单元测试。

## 常用命令（脚手架完成后应可用）
- `npm run dev`：启动 Mastra 开发服务（Studio）
- `npm run job:daily`：日常回访（含回复入库与日汇总）
- `npm run job:weekly`：周报
- `npm run approve`：命令行审批草稿
- `npm run eval`：离线评估
- `npm run typecheck` / `npm test`

## 遇到这些情况必须先问用户
- 用户 API 的真实字段、认证方式、分页方式不明
- 需要新增外部服务或依赖
- 需要放宽任何硬性规则
