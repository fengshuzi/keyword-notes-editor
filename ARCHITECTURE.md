# Keyword Notes Editor — Architecture Guide

> 本文档记录插件的核心架构决策、已知的 Obsidian API 陷阱、以及正确做法。
> 修改代码前请先阅读对应章节，避免重复踩坑。

---

## 目录

1. [整体架构](#1-整体架构)
2. [视图生命周期](#2-视图生命周期)
3. [Leaf 复用规则与标题状态（重要）](#3-leaf-复用规则与标题状态重要)
4. [Svelte 组件树与响应式](#4-svelte-组件树与响应式)
5. [Monkey-Patch 说明](#5-monkey-patch-说明)
6. [CSS 作用域隔离](#6-css-作用域隔离)
7. [FileManager 数据流](#7-filemanager-数据流)
8. [配置与解析](#8-配置与解析)

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────────┐
│  KeywordNotesPlugin (main.ts)                       │
│  ├── registerView(KEYWORD_NOTE_VIEW_TYPE)           │
│  ├── registerView(KEYWORD_LIST_VIEW_TYPE)           │
│  ├── patchWorkspace()   ← monkey-patch Workspace    │
│  ├── patchWorkspaceLeaf() ← monkey-patch Leaf       │
│  └── openKeywordView / openFolderView / ...         │
├─────────────────────────────────────────────────────┤
│  左侧栏                    主内容区                  │
│  ┌──────────────┐         ┌─────────────────────┐   │
│  │KeywordListView│        │  KeywordNoteView     │   │
│  │(sidebar tree) │─click─→│  (ItemView)          │   │
│  │              │         │  └─ Svelte:          │   │
│  │ - keywords   │         │    EditorView        │   │
│  │ - folders    │         │    └─ KeywordNote×N  │   │
│  │ - sub-tags   │         │      └─ LeafView     │   │
│  └──────────────┘         └─────────────────────┘   │
├─────────────────────────────────────────────────────┤
│  leafView.ts — KeywordNoteEditor (popover)          │
│  spawnLeafView() 为每条笔记创建悬浮编辑器 leaf       │
└─────────────────────────────────────────────────────┘
```

### 文件职责

| 文件 | 职责 |
|------|------|
| `keywordNotesPlugin.ts` | 插件入口，注册视图，monkey-patch，管理 open* 方法 |
| `keywordNoteView.ts` | 主视图（ItemView），管理 Svelte 组件生命周期和状态 |
| `keywordListView.ts` | 侧边栏视图，渲染可折叠的 keyword/folder 树 |
| `leafView.ts` | 悬浮编辑器（Popover），参考 hover-editor 实现 |
| `keywordNoteSettings.ts` | 设置界面，KeywordConfig/FolderConfig 解析 |
| `utils/fileManager.ts` | 文件扫描、标签匹配、时间过滤、排序 |
| `component/KeywordNoteEditorView.svelte` | 主内容容器，无限滚动 + viewport 管理 |
| `component/KeywordNote.svelte` | 单条笔记，lazy-load 编辑器，折叠/展开 |

---

## 2. 视图生命周期

### KeywordNoteView（主视图）

```
constructor()          ← registerView 工厂函数调用
  ↓
onOpen()               ← Obsidian 在 leaf.setViewState 后自动调用
  ├── 创建 Svelte 组件（此时 props 为默认值）
  ├── 注册 onLayoutReady(refresh)
  └── 注册 vault.on("create"/"delete")
  ↓
setState(state)        ← Obsidian 恢复 workspace state 时调用
  ├── 读取 customState 属性
  └── 如果 view 已存在 → $set 更新 props
  ↓
onClose()              ← leaf.detach() 时调用
```

**关键约束：**

- Svelte 组件**必须在 `onOpen()` 中创建**，不能在 `setState` 中创建。
  - 原因：`onOpen` 总是先于 `setState` 执行。如果在 `setState` 中创建，则 `onOpen` 阶段 Svelte 组件不存在，action button 和事件注册会失败。
- `setState` 的职责**仅是更新已有 Svelte 组件的 props**（通过 `$set`），不创建组件。
- `setState` 可能在 `setSelectionMode` 之后被 Obsidian 内部再次调用（如 workspace state save/restore），所以 `$set` 应该使用 `this.target` 等实例变量（已经被 `setSelectionMode` 更新过），而不是从 state 参数中读取。

### KeywordNoteEditor（Popover 编辑器）

每条笔记通过 `spawnLeafView()` 创建独立的悬浮 leaf：

```
spawnLeafView(plugin, initiatingEl, leaf)
  → new KeywordNoteEditor(parent, targetEl, plugin)
    → 创建 .kw-editor.kw-leaf-view 容器
    → attachLeaf() → createLeafInParent(rootSplit, 0)
  → 返回 [leaf, popover]
```

**生命周期：**
1. **constructor** → 设置 waitTime=300ms，启动 show timer
2. **show()** → 将 hoverEl 插入 DOM，调用 `onShow()`
3. **onShow()** → 移除 view header / inline-title，触发 `workspace.onLayoutChange()`
4. **hide()** → 设置 detaching=true，清理 leaf，调用 `nativeHide()`

---

## 3. Leaf 复用规则与标题状态（重要）

> ⚠️ **这是最容易出错的点。修改任何 `open*View` 方法前必读。**

### 问题

Obsidian 对**同类型 view** 连续调用 `getLeaf(true)` + `setViewState` 行为不稳定。
当已存在一个 `KEYWORD_NOTE_VIEW_TYPE` 的 leaf 时，再次 `getLeaf(true)` 创建新 leaf 可能导致：
- 新 leaf 未正确渲染
- 视图不切换，点击无响应
- workspace 布局异常

另一个常见坑是 Obsidian 1.7.2+ 的 deferred leaf：

- `workspace.getLeavesOfType(KEYWORD_NOTE_VIEW_TYPE)` 可能返回一个类型正确但尚未加载的 leaf。
- 这时 `leaf.view` 可能是 DeferredView 或旧 layout 恢复过程中的临时对象，不一定是 `KeywordNoteView`。
- 不能直接 `const view = leaf.view as KeywordNoteView` 后调用 `view.setSelectionMode()`，否则会出现 `setSelectionMode is not a function`。

还有一个由 leaf 复用引入的标题状态问题：

- 一级关键词会调用 `setKeywordDisplay(keyword)`，标题显示配置的 `icon + alias`，例如 `🍉 读书`。
- 二级/三级标签通过 `openSubTagView("ai/opencode/工具")` 打开，不会调用 `setKeywordDisplay()`。
- 如果复用同一个 view 时不清理旧的 `keywordDisplay` / `folderDisplay`，内容已切换到 `ai/opencode/工具`，但标题仍会显示上一次的 `读书`。

### 正确做法

所有 `open*View` 方法（`openKeywordView`、`openSubTagView`、`openFolderView`、`openTagView`）
必须遵循**安全复用优先**模式：

```typescript
private isKeywordNoteView(view: unknown): view is KeywordNoteView {
    return view instanceof KeywordNoteView && typeof view.setSelectionMode === "function";
}

private async getOrCreateKeywordNoteView(): Promise<{ leaf: WorkspaceLeaf; view: KeywordNoteView }> {
    const leaves = this.app.workspace.getLeavesOfType(KEYWORD_NOTE_VIEW_TYPE);

    for (const leaf of leaves) {
        await leaf.loadIfDeferred();

        if (this.isKeywordNoteView(leaf.view)) {
            return { leaf, view: leaf.view };
        }

        await leaf.setViewState({ type: KEYWORD_NOTE_VIEW_TYPE });
        await leaf.loadIfDeferred();

        if (this.isKeywordNoteView(leaf.view)) {
            return { leaf, view: leaf.view };
        }
    }

    // 只在没有任何可恢复的 KEYWORD_NOTE_VIEW_TYPE leaf 时才创建新的
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: KEYWORD_NOTE_VIEW_TYPE });
    await leaf.loadIfDeferred();

    if (!this.isKeywordNoteView(leaf.view)) {
        throw new Error("Keyword Notes Editor: failed to create keyword note view.");
    }

    return { leaf, view: leaf.view };
}
```

打开一级关键词：

```typescript
const { leaf, view } = await this.getOrCreateKeywordNoteView();

view.setSelectionMode("tag", target);
view.setTimeField("mtime");
view.setIncludeSubTags(true);
view.setKeywordDisplay(keyword); // 一级关键词覆盖为 alias/icon 标题
view.refresh();
workspace.revealLeaf(leaf);
```

打开二级/三级/更多级子标签：

```typescript
const { leaf, view } = await this.getOrCreateKeywordNoteView();

view.setSelectionMode("tag", "ai/opencode/工具");
view.setTimeField("mtime");
view.setIncludeSubTags(false);
view.refresh();
workspace.revealLeaf(leaf);
```

`KeywordNoteView.setSelectionMode()` 必须同步清理旧标题状态：

```typescript
setSelectionMode(mode: "folder" | "tag", target: string = "") {
    this.selectionMode = mode;
    this.target = target;
    this.keywordDisplay = null;
    this.folderDisplay = null;

    this.view?.$set({ selectionMode: mode, target });
    this.leaf.updateHeader();
}
```

**禁止：**
- ❌ 按 target 精确匹配查找 → 找不到就 `getLeaf(true)` 创建新的
- ❌ 每次 open 都 `getLeaf(true)` 创建新 leaf/tab
- ❌ 依赖 `getLeaf(true)` 返回全新 leaf（Obsidian 不保证）
- ❌ 未 `loadIfDeferred()` 就直接把 `leaf.view` 强转为 `KeywordNoteView`
- ❌ 切换 tag/folder 时保留旧的 `keywordDisplay` / `folderDisplay`

### 标题显示规则

`KeywordNoteView.getDisplayText()` 的优先级：

1. 一级关键词：显示 `icon + alias`，例如 `🍇 ai`
2. 文件夹：显示 `icon + alias`
3. 子标签：显示完整 tag path，例如 `#ai/opencode/工具`
4. 空状态：显示 `关键词笔记`

这个顺序不要随意调整。一级关键词需要友好别名；二级/三级/更多级子标签必须显示完整路径，否则复用 view 后用户无法判断当前实际 target。

### 多级关键词树

`KeywordListView` 支持任意层级的 tag path，不限制为二级。

示例：

```text
#ai/opencode/工具
#ai/opencode/插件
#ai/playwright
```

侧边栏树应渲染为：

```text
ai
├── opencode
│   ├── 工具
│   └── 插件
└── playwright
```

行为规则：

- 点击一级配置关键词 `ai` → `openKeywordView()`，`includeSubTags=true`，标题显示 `🍇 ai`。
- 点击中间层 `ai/opencode` → `openSubTagView("ai/opencode", true)`，包含更深层子标签，标题显示 `#ai/opencode`。
- 点击叶子层 `ai/opencode/工具` → `openSubTagView("ai/opencode/工具", false)`，只匹配该完整标签，标题显示 `#ai/opencode/工具`。
- 所有层级点击都必须走安全复用逻辑，不能新建多个主 view。

---

## 4. Svelte 组件树与响应式

### 组件树

```
KeywordNoteEditorView.svelte          ← 主容器
  ├── props: plugin, leaf, selectionMode, target, ...
  ├── 内部状态: fileManager, renderedFiles, filteredFiles, visibleNotes
  ├── reactive: fileManagerOptions → 依赖 selectionMode, target, ...
  ├── reactive: options 变更检测 → fileManager.updateOptions()
  ├── onMount: 创建 fileManager，初始加载
  └── 模板:
      ├── {#each renderedFiles} → KeywordNote (每条笔记)
      └── loader div (inview 触发无限滚动)
          │
          └── KeywordNote.svelte     ← 单条笔记
              ├── props: file, plugin, leaf, shouldRender, collapseAll
              ├── onMount: 设置 title
              ├── reactive: shouldRender 变更 → showEditor / scheduleUnload
              └── spawnLeafView() 创建 popover leaf
```

### 响应式数据流

```
外部调用 view.$set({ target: "new-tag" })
  ↓
Svelte 调度更新（微任务）
  ↓
reactive block 检测: target !== fileManager.options.target
  ↓
fileManager.updateOptions({ target: "new-tag" })
  ↓
fileManager 清空缓存 → fetchTaggedFiles() → 重新匹配
  ↓
filteredFiles = fileManager.getFilteredFiles()
renderedFiles = [] → startFillViewport() → 逐批填充
```

### 注意事项

1. **`onMount` 先于外部 `$set`**：Svelte 组件在 `onOpen()` 中创建时，`onMount` 同步触发。
   此时 `target` 为默认值 `""`，`fileManager` 用空 target 初始化，`getFilteredFiles()` 返回 `[]`。
   这是正常的——后续 `setSelectionMode` 调用 `$set` 后，reactive block 会重新获取正确的文件。

2. **`onLayoutReady(refresh)` 在 `onMount` 之后同步触发**：如果 layout 已 ready，
   `refresh()` 会在 `onOpen()` 内同步调用。此时 `fileManager` 已存在（`onMount` 已触发），
   但 target 可能还是 `""`。`refresh()` 只是清缓存重新获取，不改变 options，
   后续 `$set` 会再次触发 reactive block 更新。

3. **不要在 reactive block 外直接修改 `renderedFiles`**：必须通过 reactive block 或
   `refresh()` 方法统一管理，否则会出现文件列表不一致。

4. **无限滚动**：`startFillViewport()` 依赖 `firstLoaded` 标记确保只在首次加载或
   options 变更后触发。`fillViewport()` 每次填充 10 条。

---

## 5. Monkey-Patch 说明

> 参考 hover-editor 实现，这些 patch 让 popover leaf 在 Obsidian workspace 中正常工作。

### patchWorkspace()

| Patch | 作用 | 注意事项 |
|-------|------|----------|
| `getActiveViewOfType` | 当活跃 leaf 是 KeywordNoteView 时，返回其 `editMode`，让 Obsidian 识别编辑器 | 必须用 `fn.call(this, ...)` 不能直接 `fn(...)` |
| `changeLayout` | 设置 `layoutChanging` 标志，防止布局切换时 popover 冲突 | `layoutChanging` 目前声明但未使用 |
| `iterateLeaves` | 扩展 Obsidian 的 leaf 遍历，包含 popover 内的 leaf | 有 `_iteratingPopovers` 重入保护，防止无限递归 |
| `recordMostRecentOpenedFile` | 阻止 popover 中打开的文件被记入最近文件列表 | 空操作 |
| `setActiveLeaf` | 处理 popover leaf 的 parentLeaf：激活父 leaf，同步 editMode | 检查 `leaf.parentLeaf` 判断是否在 popover 内 |

### patchWorkspaceLeaf()

| Patch | 作用 |
|-------|------|
| `getRoot` | 递归查找根 split，处理 popover 层级 |
| `setPinned` | popover leaf 强制 pinned=true，防止自动关闭 |
| `openFile` | 阻止 popover 中打开的文件被 `recent-files` 插件记录 |

### 修改 Monkey-Patch 的原则

- 每个 patch 有明确的目的，不要随意删除或简化
- `fn.call(this, ...)` 是必须的，不能省略为 `fn(...)`，因为 Obsidian 内部方法依赖 `this` 上下文
- `iterateLeaves` 的重入保护 `_iteratingPopovers` 不能去掉，否则 `activePopovers()` 中的 DOM 查询会触发 layout-change → 再次 iterateLeaves → 死循环

---

## 6. CSS 作用域隔离

插件有两套完全独立的 CSS 作用域，不能混淆：

### `.kw-editor`（Popover / 悬浮编辑器）

- 用于 `leafView.ts` 创建的悬浮编辑器容器
- 重置 Obsidian 默认样式：`.kw-editor .workspace-leaf { all: unset; }`
- **不能改成显式属性**：`all: unset` 是必须的，用显式属性会导致 Obsidian 默认样式干扰
- 目标：让编辑器在悬浮容器中看起来干净，没有多余的边框/背景

### `.keyword-note-view`（主视图）

- 用于 `KeywordNoteEditorView.svelte` 的主内容区
- 标准 flex 布局，`overflow-x: hidden`
- 分隔线、空状态、无限滚动 loader 都在此作用域
- 不受 `.kw-editor` 样式影响

### `.keyword-list-*`（侧边栏）

- 用于 `KeywordListView` 的关键词树
- 独立的树状结构样式，折叠箭头、树线、hover 效果
- 不与上面两个作用域冲突

### 全局 body class

- `keyword-notes-hide-frontmatter` — 隐藏 frontmatter
- `keyword-notes-hide-backlinks` — 隐藏反向链接
- 通过 `document.body.toggleClass()` 控制，不影响其他插件

---

## 7. FileManager 数据流

```
FileManagerOptions 变更（通过 $set 或 updateOptions）
  ↓
updateOptions() 检测哪些字段变了
  ├── timeRange / customRange 变了 → 只重新过滤（filterFilesByRange）
  └── mode / target 变了 → 清空 allFiles，重新扫描（fetchFiles）
       ├── mode="tag"  → fetchTaggedFiles()
       │   ├── target 支持 "+" 分隔的多标签聚合
       │   ├── includeSubTags=true 时匹配 target/* 子标签
       │   └── 标签比较统一用 toLowerCase()
       └── mode="folder" → fetchFolderFiles()
           └── 匹配 target 目录及其子目录
  ↓
filterFilesByRange() → 时间范围过滤
  ↓
getFilteredFiles() → 返回最终结果
```

### 注意事项

- **标签匹配必须用 `getAllTags(cache)`**，不能用 `fileCache.tags`。
  `fileCache.tags` 只包含 inline 标签，`getAllTags` 同时覆盖 frontmatter 和 inline。
- **大小写不敏感**：target 和实际标签都 `toLowerCase()` 后比较。
- **`excludedFolders`** 排除指定目录，匹配规则是路径前缀（`folderPath === f || folderPath.startsWith(f + "/")`）。
- **`forceRefresh()` vs `updateOptions()`**：
  - `forceRefresh()` 清空所有缓存重新获取，用于手动刷新
  - `updateOptions()` 智能判断哪些变了，最小化重算

---

## 8. 配置与解析

### KeywordConfig

```typescript
{ keyword: "test", alias: "测试", icon: "🍎" }
// 单标签模式：匹配 #test

{ keyword: "p1", alias: "象限", icon: "🎯", keywords: ["p1", "p2", "p3", "p4"] }
// 聚合模式：匹配 #p1 或 #p2 或 #p3 或 #p4（任一即可）
```

- `keyword` — 主标签（用于 `getSubTagsForKeyword` 查找子标签）
- `keywords` — 多标签聚合数组，`getKeywordTarget()` 用 `"+"` 连接
- `alias` — 侧边栏显示名
- `icon` — emoji 图标，自动从水果列表分配避免重复

### FolderConfig

```typescript
{ path: "projects/work", alias: "工作项目", icon: "🍐" }
```

- `path` 保留原始大小写（不像 keyword 那样 toLowerCase）

### 解析格式

- Keyword: `"tag|alias|icon"` 或聚合 `"p1+p2+p3|Quadrant|🎯"`
- Folder: `"path|alias|icon"`
- 多项用逗号分隔
