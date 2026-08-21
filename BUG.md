# BUG.md - keyword-notes-editor 缺陷记录

> 记录已修复的功能缺陷（非 Scorecard 项）。Scorecard 相关修复记录在 `obsidian-docs/BUG.md`。
> 每条记录沉淀现象、根因、修法和回归测试位置，避免同类问题复发。

## 修复记录

### 2026-08-21 1.0.22 小红书视图把图片当成笔记

- **现象**：小红书视图打开期间，向目标目录（含子目录，如 `assets/`）新增图片文件后，图片出现在笔记导航里，被当成一篇「笔记」；选中后提示「这篇笔记没有可生成的图文页」。
- **根因**：`src/utils/fileManager.ts` 的 `fileCreate()` 在 folder/xiaohongshu 模式下，只要文件落在目标目录内就直接 `allFiles.push(file)`，没有校验扩展名。初始扫描走 `vault.getMarkdownFiles()` 天然只含 md 文件，但 vault 的 `create` 事件对任意类型文件（图片、PDF 等）都会触发，增量路径漏掉了类型过滤。
- **修法**：`fileCreate()` 的 folder/xiaohongshu 分支在目录匹配前增加 `file.extension !== "md"` 提前返回。tag/overview 模式经 `metadataCache.getFileCache()`（非 md 文件返回 null）过滤，天然安全。
- **回归测试**：`test/fileManager.test.mjs` - `fileCreate` 传入 png/jpg 断言不进入文件列表，传入 md 断言正常进入（folder 与 xiaohongshu 两种模式都覆盖）。
- **commit**: release `1.0.23`
