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
`dev`、`job:daily`、`job:weekly`、`job:catchup`、`approve`、`eval`、`typecheck`、`test`、`db:migrate`

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
