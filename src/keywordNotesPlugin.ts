import {
    Plugin,
    OpenViewState,
    TAbstractFile,
    TFile,
    TextFileView,
    Workspace,
    WorkspaceItem,
    WorkspaceLeaf,
    getAllTags,
    normalizePath,
    Platform,
    TFolder,
} from "obsidian";
import type { EventRef } from "obsidian";

import { around } from "monkey-around";
import { KeywordNoteEditor, isKeywordNoteLeaf } from "./leafView";
import "./style/index.css";
import { addIconList } from "./utils/icon";
import {
    KeywordNotesSettings,
    KeywordNotesSettingTab,
    DEFAULT_SETTINGS,
    DEFAULT_NOTE_COLOR,
    KeywordConfig,
    FolderConfig,
} from "./keywordNoteSettings";
import { OverviewTarget, TimeField } from "./types/time";
import { createUpDownNavigationExtension } from "./component/UpAndDownNavigate";
import { KEYWORD_NOTE_VIEW_TYPE, KeywordNoteView } from "./keywordNoteView";
import { KEYWORD_LIST_VIEW_TYPE, KeywordListView } from "./keywordListView";

export default class KeywordNotesPlugin extends Plugin {
    lastActiveFile: TFile;

    declare settings: KeywordNotesSettings;

    private onVaultDelete = (file: TAbstractFile) => {
        if (file instanceof TFile) {
            this.removePinnedNotePath(file.path);
            this.removeNoteColor(file.path);
        }
    };

    private onVaultRename = (file: TAbstractFile, oldPath: string) => {
        if (file instanceof TFile) {
            this.renamePinnedNotePath(oldPath, file.path);
            this.renameNoteColor(oldPath, file.path);
        }
    };
    

    async onload() {
        this.addSettingTab(new KeywordNotesSettingTab(this.app, this));
        await this.loadSettings();
        this.patchWorkspace();
        this.patchWorkspaceLeaf();
        this.patchEmbeddedTextFileUnload();
        this.registerEmbeddedEditorErrorFilter();
        addIconList();

        // Register the up and down navigation extension
        if (this.settings.useArrowUpOrDownToNavigate) {
            this.registerEditorExtension([
                createUpDownNavigationExtension({
                    app: this.app,
                    plugin: this,
                }),
            ]);
        }

        this.registerView(
            KEYWORD_NOTE_VIEW_TYPE,
            (leaf: WorkspaceLeaf) => new KeywordNoteView(leaf, this)
        );

        // Register keyword list sidebar view
        this.registerView(
            KEYWORD_LIST_VIEW_TYPE,
            (leaf: WorkspaceLeaf) => new KeywordListView(leaf, this)
        );

        this.addRibbonIcon("list", "Open keyword list", () => {
            void this.activateKeywordListView();
        });

        this.addCommand({
            id: "open-keyword-list",
            name: "Open keyword list",
            callback: () => {
                void this.activateKeywordListView();
            },
        });

        this.initCssRules();
        this.registerEvent(this.app.vault.on("delete", this.onVaultDelete));
        this.registerEvent(this.app.vault.on("rename", this.onVaultRename));

        // Open keyword list sidebar by default
        this.app.workspace.onLayoutReady(() => {
            if (this.settings.openKeywordListOnStartup) {
                void this.activateKeywordListView();
            }
        });
    }

    onunload() {
        document.body.toggleClass("keyword-notes-hide-frontmatter", false);
        document.body.toggleClass("keyword-notes-hide-backlinks", false);
        document.body.style.removeProperty("--keyword-notes-default-color");
    }

    // Activate keyword list sidebar
    async activateKeywordListView() {
        const { workspace } = this.app;
        
        let leaf = workspace.getLeavesOfType(KEYWORD_LIST_VIEW_TYPE)[0];
        
        if (!leaf) {
            // Create a dedicated sidebar leaf instead of reusing another plugin's leaf.
            const leftLeaf = workspace.getLeftLeaf(true);
            if (leftLeaf) {
                await leftLeaf.setViewState({
                    type: KEYWORD_LIST_VIEW_TYPE,
                    active: true,
                });
                leaf = leftLeaf;
            }
        }
        
        if (leaf) {
            await workspace.revealLeaf(leaf);
        }
    }

    // Refresh keyword list
    refreshKeywordList() {
        const leaves = this.app.workspace.getLeavesOfType(KEYWORD_LIST_VIEW_TYPE);
        leaves.forEach(leaf => {
            if (leaf.view instanceof KeywordListView) {
                leaf.view.refresh();
            }
        });
    }

    refreshKeywordNoteViews() {
        const leaves = this.app.workspace.getLeavesOfType(KEYWORD_NOTE_VIEW_TYPE);
        leaves.forEach((leaf) => {
            if (leaf.view instanceof KeywordNoteView) {
                leaf.view.refresh();
            }
        });
    }



    // Get keyword target (single tag is keyword, aggregation is p1+p2+p3+p4)
    private getKeywordTarget(keyword: KeywordConfig): string {
        if (keyword.keywords && keyword.keywords.length > 0) {
            return keyword.keywords.join("+");
        }
        return keyword.keyword;
    }

    private isKeywordNoteView(view: unknown): view is KeywordNoteView {
        return view instanceof KeywordNoteView && typeof view.setSelectionMode === "function";
    }

    private async getOrCreateKeywordNoteView(): Promise<{ leaf: WorkspaceLeaf; view: KeywordNoteView }> {
        if (Platform.isMobile) {
            const existingLeaves = this.app.workspace.getLeavesOfType(KEYWORD_NOTE_VIEW_TYPE);
            const leaf = existingLeaves[0] ?? this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(false);

            for (const duplicate of existingLeaves.slice(1)) {
                await duplicate.detach();
            }

            await leaf.setViewState({ type: KEYWORD_NOTE_VIEW_TYPE });
            await leaf.loadIfDeferred();

            if (!this.isKeywordNoteView(leaf.view)) {
                throw new Error("Keyword Notes Editor: failed to create mobile keyword note view.");
            }

            return { leaf, view: leaf.view };
        }

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

            console.warn("Keyword Notes Editor: skipping invalid keyword note leaf", leaf.view);
        }

        const leaf = this.app.workspace.getLeaf(true);
        await leaf.setViewState({ type: KEYWORD_NOTE_VIEW_TYPE });
        await leaf.loadIfDeferred();

        if (!this.isKeywordNoteView(leaf.view)) {
            throw new Error("Keyword Notes Editor: failed to create keyword note view.");
        }

        return { leaf, view: leaf.view };
    }

    private async revealKeywordNoteLeaf(leaf: WorkspaceLeaf, view: KeywordNoteView): Promise<void> {
        const workspace = this.app.workspace;

        if (!Platform.isMobile) {
            await workspace.revealLeaf(leaf);
            return;
        }

        workspace.leftSplit?.collapse();
        workspace.rightSplit?.collapse();

        await workspace.revealLeaf(leaf);

        // Obsidian Mobile can leave a custom view as a blank tab after revealLeaf()
        // until the user opens the tab switcher. Force the same activation/layout pass.
        workspace.setActiveLeaf(leaf, { focus: true });
        workspace.onLayoutChange();

        await new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => resolve());
            });
        });

        workspace.setActiveLeaf(leaf, { focus: true });
        workspace.onLayoutChange();
        view.refresh();

        window.setTimeout(() => {
            workspace.setActiveLeaf(leaf, { focus: true });
            workspace.onLayoutChange();
            view.refresh();
        }, 350);
    }

    // IMPORTANT: 所有 open*View 方法必须复用已有的 KEYWORD_NOTE_VIEW_TYPE leaf，
    // 而非每次 getLeaf(true) 创建新 leaf。原因：Obsidian 对同类型 view 连续调用
    // getLeaf(true) + setViewState 行为不稳定，会导致视图不切换。
    // 正确做法：找到已有 leaf → 更新查询条件 → 由 Svelte 视图重建列表 → revealLeaf。

    // Open keyword view (includes sub-tags by default)
    async openKeywordView(keyword: KeywordConfig) {
        const target = this.getKeywordTarget(keyword);
        const { leaf, view } = await this.getOrCreateKeywordNoteView();

        view.setSelectionMode("tag", target);
        view.setTimeField("mtime");
        view.setIncludeSubTags(true);
        view.setKeywordDisplay(keyword);

        await this.revealKeywordNoteLeaf(leaf, view);
    }

    // Open sub-tag view (includeSubTags=true also includes deeper sub-tags)
    async openSubTagView(subTag: string, includeSubTags = false) {
        const { leaf, view } = await this.getOrCreateKeywordNoteView();

        view.setSelectionMode("tag", subTag);
        view.setTimeField("mtime");
        view.setIncludeSubTags(includeSubTags);

        await this.revealKeywordNoteLeaf(leaf, view);
    }

    // 获取某个关键词下的所有子标签（如 test → ['test/work', 'test/ideas']）
    getSubTagsForKeyword(keyword: string): string[] {
        const prefix = keyword.toLowerCase().replace(/^#/, '');
        const subTags = new Set<string>();

        this.app.vault.getMarkdownFiles().forEach(file => {
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache) {
                const tags = getAllTags(cache) || [];
                tags.forEach(tag => {
                    const t = tag.toLowerCase().replace(/^#/, '');
                    if (t.startsWith(prefix + '/')) {
                        subTags.add(t);
                    }
                });
            }
        });

        return Array.from(subTags).sort();
    }

    // 打开文件夹视图
    async openFolderView(folder: FolderConfig) {
        const { leaf, view } = await this.getOrCreateKeywordNoteView();

        view.setSelectionMode("folder", folder.path);
        view.setTimeField("mtime");
        view.setFolderDisplay(folder);

        await this.revealKeywordNoteLeaf(leaf, view);
    }

    async openTagView(tagName: string, timeField: TimeField = "mtime") {
        const { leaf, view } = await this.getOrCreateKeywordNoteView();

        view.setSelectionMode("tag", tagName);
        view.setTimeField(timeField);

        await this.revealKeywordNoteLeaf(leaf, view);
    }

    async openOverviewView(target: OverviewTarget) {
        const { leaf, view } = await this.getOrCreateKeywordNoteView();

        view.setSelectionMode("overview", target);
        view.setTimeField("mtime");
        view.setIncludeSubTags(false);
        view.setOverviewDisplay(target);

        await this.revealKeywordNoteLeaf(leaf, view);
    }

    // 获取包含指定标签的所有文件
    getFilesWithTag(tagName: string): TFile[] {
        const files: TFile[] = [];
        const tagLower = tagName.toLowerCase().replace(/^#/, '');
        
        this.app.vault.getMarkdownFiles().forEach(file => {
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache) {
                const tags = getAllTags(cache) || [];
                const hasTag = tags.some(tag => {
                    const t = tag.toLowerCase().replace(/^#/, '');
                    return t === tagLower || t.startsWith(tagLower + '/');
                });
                if (hasTag) {
                    files.push(file);
                }
            }
        });
        
        return files;
    }

    initCssRules() {
        document.body.toggleClass(
            "keyword-notes-hide-frontmatter",
            this.settings.hideFrontmatter
        );
        document.body.toggleClass(
            "keyword-notes-hide-backlinks",
            this.settings.hideBacklinks
        );
        this.applyDefaultNoteColor();
    }

    applyDefaultNoteColor() {
        document.body.style.setProperty(
            "--keyword-notes-default-color",
            this.settings.defaultNoteColor || DEFAULT_NOTE_COLOR
        );
    }

    patchWorkspace() {
        let layoutChanging = false; void layoutChanging;
        const wrapper = {
            getActiveViewOfType: (next: (...args: unknown[]) => unknown) =>
                function (this: unknown, t: unknown) {
                    const fn = next as (type: { VIEW_TYPE?: string }, ...args: unknown[]) => { VIEW_TYPE?: string } | null;
                    const result = fn.call(this, t as { VIEW_TYPE?: string });
                    if (!result) {
                        if ((t as { VIEW_TYPE?: string })?.VIEW_TYPE === "markdown") {
                            const activeLeaf = this as unknown as { activeLeaf?: { view?: { editMode?: unknown } } };
                            if (activeLeaf.activeLeaf?.view instanceof KeywordNoteView) {
                                return activeLeaf.activeLeaf.view.editMode;
                            } else {
                                return result;
                            }
                        }
                    }
                    return result;
                },
            changeLayout: (old: (...args: unknown[]) => unknown) =>
                async function (workspace: unknown) {
                    layoutChanging = true;
                    try {
                        await old.call(this, workspace);
                    } finally {
                        layoutChanging = false;
                    }
                },
            iterateLeaves: (old: (...args: unknown[]) => unknown) =>
                function (this: unknown, arg1: unknown, arg2: unknown) {
                    type leafIterator = (item: WorkspaceLeaf) => boolean | void;
                    const oldFn = old as (arg1: leafIterator | WorkspaceItem, arg2?: leafIterator) => boolean;
                    if (oldFn.call(this, arg1 as (WorkspaceItem | leafIterator), arg2 as leafIterator | undefined)) return true;

                    const cb: leafIterator = (
                        typeof arg1 === "function" ? arg1 as leafIterator : arg2 as leafIterator
                    );
                    return KeywordNoteEditor.iteratePopoverLeaves(
                        this as unknown as Workspace,
                        cb
                    ) as unknown;
                },
            setActiveLeaf: (next: (...args: unknown[]) => unknown) =>
                function (this: unknown, e: unknown, t?: unknown) {
                    const setFn = next as (leaf: WorkspaceLeaf, params?: { focus?: boolean } | boolean) => void;
                    const workspaceLeaf = e as WorkspaceLeaf;
                    const leaf = e as unknown as { parentLeaf?: WorkspaceLeaf & { activeTime?: number; view?: { editMode?: unknown } } };
                    if (isKeywordNoteLeaf(workspaceLeaf) && leaf.parentLeaf) {
                        leaf.parentLeaf.activeTime = 1700000000000;
                        setFn.call(this, leaf.parentLeaf, (t as { focus?: boolean }) ?? {});
                        const editMode = ((e as unknown as { view?: { editMode?: unknown } }).view as unknown as { editMode?: unknown })?.editMode;
                        if (editMode) {
                            (this as unknown as { activeEditor: unknown }).activeEditor = (e as unknown as { view: unknown }).view;
                            (leaf.parentLeaf.view as unknown as { editMode?: unknown }).editMode = (e as unknown as { view: unknown }).view;
                        }
                        return;
                    }
                    return setFn.call(this, e as WorkspaceLeaf, (t as { focus?: boolean }) ?? {});
                },
        };
        const uninstaller = around(
            Workspace.prototype,
            wrapper as unknown as Parameters<typeof around<Workspace>>[1]
        );
        this.register(uninstaller);
    }

    patchWorkspaceLeaf() {
        this.register(
            around(WorkspaceLeaf.prototype, {
                getRoot(old) {
                    return function () {
                        if (!isKeywordNoteLeaf(this)) return old.call(this);
                        const top = old.call(this);
                        return top?.getRoot === this.getRoot
                            ? top
                            : top?.getRoot();
                    };
                },
                setPinned(old) {
                    return function (pinned: boolean) {
                        old.call(this, pinned);
                        if (isKeywordNoteLeaf(this) && !pinned)
                            this.setPinned(true);
                    };
                },
                openFile(old) {
                    return function (file: TFile, openState?: OpenViewState) {
                        return old.call(this, file, openState);
                    };
                },
            })
        );
    }

    private patchEmbeddedTextFileUnload(): void {
        type OnUnloadFile = (this: TextFileView, file: TFile) => Promise<void>;

        this.register(
            around(TextFileView.prototype, {
                onUnloadFile: (old: OnUnloadFile) => {
                    return async function (this: TextFileView, file: TFile): Promise<void> {
                        try {
                            await old.call(this, file);
                        } catch (error) {
                            if (KeywordNotesPlugin.isEmbeddedEditorUnloadHistoryError(error)) {
                                return;
                            }
                            throw error;
                        }
                    };
                },
            })
        );
    }

    private registerEmbeddedEditorErrorFilter(): void {
        const handler = (event: PromiseRejectionEvent) => {
            if (!KeywordNotesPlugin.isEmbeddedEditorUnloadHistoryError(event.reason)) return;
            event.preventDefault();
        };

        window.addEventListener("unhandledrejection", handler);
        this.register(() => window.removeEventListener("unhandledrejection", handler));

        const origConsoleError = console.error;
        console.error = (...args: unknown[]) => {
            if (args.some((a) => KeywordNotesPlugin.isEmbeddedEditorUnloadHistoryError(a))) return;
            origConsoleError.apply(console, args);
        };
        this.register(() => { console.error = origConsoleError; });
    }

    private static isEmbeddedEditorUnloadHistoryError(reason: unknown): boolean {
        if (!(reason instanceof RangeError)) return false;
        if (reason.message !== "Field is not present in this state") return false;

        const stack = typeof reason.stack === "string" ? reason.stack : "";
        return stack.includes("saveHistory") || stack.includes("beforeUnload");
    }

    public async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );
        
        // Reassign icons to ensure keywords and folders do not have duplicate icons
        this.reassignIcons();
        this.prunePinnedNotes();
    }
    
    // Reassign icons to avoid duplicates
    private reassignIcons() {
        const FRUIT_ICONS = ['🍎', '🍏', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🌽', '🥕', '🥦', '🌰'];
        
        // 收集已使用的自定义图标
        const usedIcons: string[] = []; void usedIcons;
        
        // 先处理有自定义图标的项
        this.settings.keywords.forEach(k => {
            if (k.icon && FRUIT_ICONS.includes(k.icon)) {
                // 检查是否是用户手动设置的（通过配置字符串中是否有第三个参数判断）
                // 这里简化处理：如果图标在列表中，先标记为已使用
            }
        });
        
        // 为关键词分配图标
        let iconIndex = 0;
        this.settings.keywords.forEach((k, index) => { void index;
            // 如果没有自定义图标，分配一个
            if (!k.icon || FRUIT_ICONS.includes(k.icon)) {
                k.icon = FRUIT_ICONS[iconIndex % FRUIT_ICONS.length];
                iconIndex++;
            }
        });
        
        // 为文件夹分配图标（从关键词之后继续）
        this.settings.folders.forEach((f, index) => { void index;
            if (!f.icon || FRUIT_ICONS.includes(f.icon)) {
                f.icon = FRUIT_ICONS[iconIndex % FRUIT_ICONS.length];
                iconIndex++;
            }
        });
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    getPinnedScopeKey(mode: "folder" | "tag" | "overview", target: string, includeSubTags = false): string {
        if (mode === "overview") {
            return `overview:${target}`;
        }

        if (mode === "folder") {
            const folder = normalizePath(target || "").replace(/^\/+|\/+$/g, "");
            return `folder:${folder}`;
        }

        const tagTarget = (target || "")
            .split("+")
            .map(tag => tag.trim().replace(/^#/, "").toLowerCase())
            .filter(Boolean)
            .join("+");
        return `tag:${tagTarget}:sub:${includeSubTags ? "1" : "0"}`;
    }

    getPinnedNotePaths(scopeKey: string): string[] {
        this.prunePinnedNotes(scopeKey);
        return [...(this.settings.pinnedNotes?.[scopeKey] ?? [])];
    }

    isNotePinned(scopeKey: string, file: TFile): boolean {
        return (this.settings.pinnedNotes?.[scopeKey] ?? []).includes(file.path);
    }

    async setNotePinned(scopeKey: string, file: TFile, pinned: boolean): Promise<void> {
        const pinnedNotes = this.settings.pinnedNotes ?? {};
        const existing = pinnedNotes[scopeKey] ?? [];
        const withoutCurrent = existing.filter(path => path !== file.path);

        if (pinned) {
            pinnedNotes[scopeKey] = [file.path, ...withoutCurrent];
        } else if (withoutCurrent.length > 0) {
            pinnedNotes[scopeKey] = withoutCurrent;
        } else {
            delete pinnedNotes[scopeKey];
        }

        this.settings.pinnedNotes = pinnedNotes;
        this.prunePinnedNotes(scopeKey, false);
        await this.saveSettings();
    }

    getNoteColor(filePath: string): string | null {
        return this.settings.noteColors?.[filePath] ?? null;
    }

    setNoteColor(filePath: string, color: string | null): void {
        const colors = this.settings.noteColors ?? {};
        if (color === null) {
            delete colors[filePath];
        } else {
            colors[filePath] = color;
        }
        this.settings.noteColors = colors;
        void this.saveSettings();
    }

    removeNoteColor(filePath: string): void {
        const colors = this.settings.noteColors;
        if (colors && filePath in colors) {
            delete colors[filePath];
            void this.saveSettings();
        }
    }

    renameNoteColor(oldPath: string, newPath: string): void {
        const colors = this.settings.noteColors;
        if (colors && oldPath in colors) {
            colors[newPath] = colors[oldPath];
            delete colors[oldPath];
            void this.saveSettings();
        }
    }

        removePinnedNotePath(filePath: string): void {
        const pinnedNotes = this.settings.pinnedNotes;
        if (!pinnedNotes) return;

        let changed = false;
        for (const scopeKey of Object.keys(pinnedNotes)) {
            const nextPaths = pinnedNotes[scopeKey].filter(path => path !== filePath);
            if (nextPaths.length !== pinnedNotes[scopeKey].length) {
                changed = true;
                if (nextPaths.length > 0) {
                    pinnedNotes[scopeKey] = nextPaths;
                } else {
                    delete pinnedNotes[scopeKey];
                }
            }
        }

        if (changed) {
            void this.saveSettings();
        }
    }

    renamePinnedNotePath(oldPath: string, newPath: string): void {
        const pinnedNotes = this.settings.pinnedNotes;
        if (!pinnedNotes) return;

        let changed = false;
        for (const scopeKey of Object.keys(pinnedNotes)) {
            const nextPaths = pinnedNotes[scopeKey].map(path => path === oldPath ? newPath : path);
            if (nextPaths.some((path, index) => path !== pinnedNotes[scopeKey][index])) {
                changed = true;
                pinnedNotes[scopeKey] = Array.from(new Set(nextPaths));
            }
        }

        if (changed) {
            this.prunePinnedNotes(undefined, false);
            void this.saveSettings();
        }
    }

    prunePinnedNotes(scopeKey?: string, save = true): boolean {
        const pinnedNotes = this.settings.pinnedNotes ?? {};
        const scopeKeys = scopeKey ? [scopeKey] : Object.keys(pinnedNotes);
        let changed = false;

        for (const key of scopeKeys) {
            const paths = pinnedNotes[key];
            if (!paths) continue;

            const existingPaths = paths.filter(path => this.app.vault.getAbstractFileByPath(path) instanceof TFile);
            if (existingPaths.length !== paths.length) {
                changed = true;
                if (existingPaths.length > 0) {
                    pinnedNotes[key] = existingPaths;
                } else {
                    delete pinnedNotes[key];
                }
            }
        }

        this.settings.pinnedNotes = pinnedNotes;
        if (changed && save) {
            void this.saveSettings();
        }
        return changed;
    }

    private getTimestampFileStem(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const hour = String(date.getHours()).padStart(2, "0");
        const minute = String(date.getMinutes()).padStart(2, "0");
        const second = String(date.getSeconds()).padStart(2, "0");
        const millisecond = String(date.getMilliseconds()).padStart(3, "0");
        return `${year}${month}${day}${hour}${minute}${second}${millisecond}`;
    }

    private getNewPageFolder(): string {
        return normalizePath(this.settings.newPageFolder || "pages").replace(/^\/+|\/+$/g, "");
    }

    private async ensureFolderExists(folderPath: string): Promise<void> {
        if (!folderPath) return;

        let currentPath = "";
        for (const part of folderPath.split("/").filter(Boolean)) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            const existing = this.app.vault.getAbstractFileByPath(currentPath);

            if (existing instanceof TFolder) continue;
            if (existing) {
                throw new Error(`Cannot create folder "${currentPath}" because a file already exists at that path.`);
            }

            await this.app.vault.createFolder(currentPath);
        }
    }

    private getAvailableNewPagePath(folderPath: string, fileStem: string): string {
        const prefix = folderPath ? `${folderPath}/` : "";
        let filePath = `${prefix}${fileStem}.md`;
        let suffix = 1;

        while (this.app.vault.getAbstractFileByPath(filePath)) {
            filePath = `${prefix}${fileStem}-${suffix}.md`;
            suffix++;
        }

        return filePath;
    }

    private waitForMetadataCache(filePath: string, timeoutMs = 2000): Promise<void> {
        return new Promise<void>((resolve) => {
            let done = false;
            let timer = 0;
            let ref: EventRef | null = null;

            const finish = () => {
                if (done) return;
                done = true;
                if (timer) window.clearTimeout(timer);
                if (ref) this.app.metadataCache.offref(ref);
                resolve();
            };

            ref = this.app.metadataCache.on("changed", (file: TFile) => {
                if (file.path === filePath) finish();
            });
            timer = window.setTimeout(finish, timeoutMs);
        });
    }

    async createPageWithKeyword(tag: string): Promise<void> {
        const now = new Date();
        const normalizedTag = tag.trim().replace(/^#/, "");
        const folder = this.getNewPageFolder();
        const filePath = this.getAvailableNewPagePath(folder, this.getTimestampFileStem(now));
        const content = `#${normalizedTag}\n`;

        try {
            await this.ensureFolderExists(folder);
            await this.app.vault.create(filePath, content);
            await this.waitForMetadataCache(filePath);
            await this.openKeywordViewForTag(normalizedTag);
        } catch (error) {
            console.error("Keyword Notes Editor: failed to create page", error);
        }
    }

    private async openKeywordViewForTag(tag: string): Promise<void> {
        const { leaf, view } = await this.getOrCreateKeywordNoteView();
        const tagLower = tag.toLowerCase();
        const rootTag = tagLower.includes("/") ? tagLower.split("/")[0] : tagLower;
        const keyword = this.settings.keywords.find(k => {
            if (k.keywords && k.keywords.length > 0) {
                return k.keywords.some(kw => tagLower === kw || tagLower.startsWith(kw + "/"));
            }
            return tagLower === k.keyword || tagLower.startsWith(k.keyword + "/") || rootTag === k.keyword;
        });

        view.setSelectionMode("tag", tagLower);
        view.setTimeField("mtime");
        view.setIncludeSubTags(true);
        if (keyword) {
            view.setKeywordDisplay(keyword);
        }

        await this.revealKeywordNoteLeaf(leaf, view);
    }
}
