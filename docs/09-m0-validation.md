# 09 M0 验证记录

本轮实现范围：M0 骨架与 mock，加上用户确认提前的 UI、mock 审批/编辑/拒绝、Mastra 暂停恢复与模拟发送。此记录不代表 M1–M4 已验收。

## 自动验证

- `pnpm typecheck`：通过。
- `ppnpm test`：3 个测试文件、17 项测试通过。
- `pnpm build`：生产 UI 构建通过。
- `pnpm dev`：Mastra Studio 成功启动，HTTP 200；适配启动器切换工作目录的行为。
- `pnpm approve`：通过交互终端验证编辑后批准与退出，UI 同步显示批准结果。
- `pnpm start`：生产静态构建成功提供页面，重启后原有运行、尝试次数与待审批队列保留。
- `pnpm job:daily`：生成 6 封 mock 草稿，状态为 waiting_approval，输出在 `out/drafts/`。
- 隐私投影与 redact、草稿护栏、调用和用户上限、live/real 配置拒绝。
- Mastra 等待审批状态跨容器重建持久化；编辑和拒绝后恢复并模拟发送。
- 重复启动和重复审批冲突；取消检查点、人工重试、文件导出失败后草稿去重。
- 进程退出后的 interrupted 状态；两套 playbook 切换；已处理用户去重。
- API 正常闭环、错误格式、请求体上限、跨站 Origin 与 Host 校验。
- 业务库与 Mastra 存储的所有实际创建表均检查无外键。

## 浏览器验证

本地 UI 实际操作：编辑主题并批准、拒绝、完成剩余审批，最终 5 封 simulated、1 封 rejected，真实发送为 0。切换 demo-alt 发起另一批回访，产生对应学习业务草稿。

桌面与窄屏断点均实测；窄屏导航可访问名称、空筛选状态、审批控件可用，页面无横向溢出；浏览器没有捕获到 console error/warn。

## 验证边界

全部证据来自虚构用户、stub 模型、本地 SQLite 与文件输出。真实用户 API、模型工具调用、真实 token 与费用、Resend、轮询回复、日汇总与周报没有接入，留待对应里程碑和资料确认。
