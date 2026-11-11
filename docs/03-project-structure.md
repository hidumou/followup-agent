# 03 项目结构

```
followup-agent/
├─ AGENTS.md  CLAUDE.md  README.md
├─ docs/                       本规格文档 + backlog.md
├─ config/
│  └─ app.config.ts            选择 adapter 档位与 playbook 的配置入口
├─ playbooks/
│  ├─ demo/                    演示业务 A：playbook.md、labels.yaml、report-template.md
│  ├─ demo-alt/                演示业务 B（用于证明换业务只改配置）
│  └─ default/                 你的真实业务，初始为空模板
├─ fixtures/                   mock 用户、mock 回复（全部为虚构数据）
├─ db/migrations/              SQL 迁移文件
├─ scripts/                    cron / launchd 包装脚本与安装说明
├─ src/
│  ├─ core/
│  │  ├─ domain/               类型、状态枚举
│  │  ├─ ports/                UserSource、Mailer、RecordStore、Notifier
│  │  ├─ privacy/              匿名化、redact()
│  │  ├─ guards/               草稿护栏
│  │  ├─ playbook/             playbook 加载器
│  │  └─ send/                 SendService
│  ├─ adapters/
│  │  ├─ mock/                 MockUserSource、FileMailer（写文件、读文件）
│  │  ├─ http-user-source/     调用真实用户 API
│  │  ├─ resend/               ResendMailer、ResendNotifier
│  │  └─ sqlite/               SqliteRecordStore
│  ├─ mastra/                  遵循 Mastra 目录约定
│  │  ├─ index.ts              Mastra 实例，注册 agents 与 workflows
│  │  ├─ agents/               classify、draft、extract、insight
│  │  ├─ tools/                insight agent 使用的只读工具
│  │  ├─ workflows/            daily-followup、reply-ingest、daily-digest
│  │  └─ scorers/              评估打分
│  ├─ cli/                     job:daily、job:weekly、approve、eval
│  └─ runtime/                 env.ts（zod 校验环境变量）、container.ts（装配）
├─ test/                       单元与集成测试
├─ .env.example  .gitignore  package.json  tsconfig.json
```

## package.json 脚本
`dev`、`job:daily`、`job:weekly`、`approve`、`eval`、`typecheck`、`test`、`db:migrate`

## 环境变量（`.env.example` 必须包含，值为空或示例）

| 变量 | 说明 |
|---|---|
| `ADAPTER_PROFILE` | `mock` 或 `real` |
| `PLAYBOOK` | playbook 目录名，如 `demo` |
| `SEND_MODE` | `dry-run`（默认）或 `live` |
| `SEND_ALLOWLIST` | live 阶段允许发送的邮箱，逗号分隔，初期只放自己的邮箱 |
| `MODEL_FAST` / `MODEL_WRITER` / `MODEL_REPORT` | 三档模型，格式 `provider/model`，具体名称以 Mastra 模型列表为准 |
| `OPENAI_API_KEY` / `ARK_API_KEY` | 模型密钥 |
| `USER_API_BASE_URL` / `USER_API_TOKEN` | 用户数据平台 API |
| `RESEND_API_KEY` / `MAIL_FROM` / `MAIL_REPLY_TO` | 发信与接收 |
| `DIGEST_RECIPIENTS` | 日汇总与周报收件人（决策者） |
| `DB_URL` | 如 `file:./data/followup.db` |
| `MAX_USERS_PER_RUN` / `MAX_LLM_CALLS_PER_RUN` / `DAILY_TOKEN_BUDGET` | 运行上限 |

## 约定
- `core/` 内禁止 import `adapters/` 或第三方平台 SDK。
- 所有环境变量只在 `runtime/env.ts` 读取并校验，其余代码通过依赖注入使用。
- `data/`、`logs/`、`out/`、`.env` 加入 `.gitignore`。

## 新增目录

```
docs/assets/design-tokens.css        设计令牌，控制台直接引用
playbooks/<name>/VERSION             当前版本号
playbooks/<name>/CHANGELOG.md        版本变更说明
src/core/services/                   各 Service（CLI 与控制台共用）
src/core/evolution/                  versioning、signals、proposal、regression
src/mastra/agents/playbook-proposer.ts
src/mastra/workflows/playbook-proposal.ts
src/console/server/                  控制台服务端：路由调用 services，校验 Host、Origin 与会话令牌
src/console/web/                     控制台前端：pages、components、styles（引用 design-tokens.css）
```

## 新增环境变量

| 变量 | 说明 |
|---|---|
| `MODEL_PROPOSER` | 提议 agent 使用的模型 |
| `PROPOSAL_MIN_SIGNALS` | 触发提议所需的最少新信号数（默认 20） |
| `PROPOSAL_MIN_EVIDENCE` | 每条 proposal 所需的最少独立证据数（默认 3） |
| `PROPOSAL_MAX_PER_RUN` | 每次最多生成的 proposal 数（默认 3） |
| `PROPOSAL_MAX_DIFF_LINES` | 单条 proposal 的 diff 行数上限（默认 20） |
| `REPORT_REVIEW_FIRST` | 报告是否先由操作者确认再发给决策者（默认 true） |
| `DRAFT_TTL_DAYS` | 草稿过期天数（默认 7） |
| `LOW_CONFIDENCE` | 低置信度阈值（默认 0.6） |
| 自动重试 | 按用户确认不启用；失败后人工重试，无 `RETRY_MAX` 配置 |
| `CONSOLE_HOST` / `CONSOLE_PORT` | 地址固定 `127.0.0.1`；端口默认 4180，兼容旧 `UI_PORT`，`CONSOLE_PORT` 优先 |

## 新增脚本
`status`、`followups`、`replies`、`report`、`playbook`、`playbook:propose`、`playbook:review`、`runs`、`config:show`、`job:ingest`、`console`、`console:dev`、`console:build`

## 当前 M0 实现

目录图包含后续里程碑目标；实际已提供脚本以 `package.json` 为准。`console` / `console:dev` / `console:build`、`status`、`followups list|show <id>`、`runs list|show|retry|cancel <id>` 已可用。`dev:ui` 和 `start` 保持兼容。

回访记录由 SQLite 中已持久化的运行、逐用户匿名上下文、分类结果与草稿投影；历史数据缺失字段不回填猜测值。Playbook 当前规则仍存放在 `playbook.json`，新增 `VERSION`，完整历史版本管理在 M1 实现。
