# Changelog

所有重要变更都会记录在此文件中。

## [0.85.1-alpha.8] - 2026-09-10

### Added

- 增加在系统文件管理器中定位当前预览文件的功能。
- macOS DMG 增加 `Fix Pi Desktop.command` 启动修复辅助工具。

### Changed

- 聊天输入栏改为队列菜单，并改进面板切换时的滚动行为。
- 应用、npm、Tauri 和 Cargo 版本号统一为 `0.85.1-alpha.8`。
- `package.json` 作为唯一版本源，`npm run version:set -- <version>` 会同步全部派生版本字段。

### Fixed

- 修复发布 tag 与项目版本号不一致导致版本检查失败的问题。
- MCP 连通性测试改为发送实际应用版本，不再使用硬编码版本号。

## [0.85.1-alpha.7] - 2026-09-09

### Added

- 增加统一版本同步脚本 `npm run version:sync`。
- 增加版本一致性检查 `npm run version:check`，并接入 GitHub Actions。
- 更新入口改为图标显示，完整版本号通过悬停提示查看。

### Changed

- Pi 核心包升级至 0.85.1：`pi-agent-core`、`pi-ai`、`pi-coding-agent`、`pi-tui`。
- APIsets 的 `gpt-*` 模型改用 OpenAI Responses API，其他模型继续使用 Anthropic Messages API。
- 应用、npm、Tauri 和 Cargo 版本号统一为 `0.85.1-alpha.7`。

### Fixed

- 修复 Responses API 已发送终态事件但 SSE 连接未关闭时，Agent 状态持续运行的问题。
- 修复 Pi 0.85.1 更新后纯文本主题缺少基础颜色导致 RPC 初始化失败的问题。
- 修复 Windows CRLF 换行导致版本检查误报不一致的问题。
