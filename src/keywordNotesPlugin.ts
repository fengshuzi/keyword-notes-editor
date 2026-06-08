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
    TFolder,
    MarkdownFileInfo,
    requireApiVersion,
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
    NOTE_COLORS,
    KeywordConfig,
    FolderConfig,
} from "./keywordNoteSettings";
import { OverviewTarget, TimeField } from "./types/time";
import { createUpDownNavigationExtension } from "./component/UpAndDownNavigate";
import { KEYWORD_NOTE_VIEW_TYPE, KeywordNoteView } from "./keywordNoteView";
import { KEYWORD_LIST_VIEW_TYPE, KeywordListView } from "./keywordListView";

type ViewConstructor = { VIEW_TYPE?: string };
type MarkdownViewLike = { editMode?: unknown };
type LeafWithParent = WorkspaceLeaf & {
    parentLeaf?: WorkspaceLeaf & {
        activeTime?: number;
        view?: MarkdownViewLike;
    };
};
type WorkspaceSetActiveParams = { focus?: boolean } | boolean;
type LeafIterator = (item: WorkspaceLeaf) => boolean | void;

export default class KeywordNotesPlugin extends Plugin {
    lastActiveFile?: TFile;

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
        activeDocument.body.toggleClass("keyword-notes-hide-frontmatter", false);
        activeDocument.body.toggleClass("keyword-notes-hide-backlinks", false);
        activeDocument.body.style.removeProperty("--keyword-notes-default-color");
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

    private async openKeywordNoteView(configure: (view: KeywordNoteView) => void): Promise<void> {
        const workspace = this.app.workspace;
        workspace.detachLeavesOfType(KEYWORD_NOTE_VIEW_TYPE);

        const leaf = workspace.getLeaf(true);
        await leaf.setViewState({ type: KEYWORD_NOTE_VIEW_TYPE, active: true });
        await leaf.loadIfDeferred();

        if (!this.isKeywordNoteView(leaf.view)) {
            throw new Error("Keyword Notes Editor: failed to create keyword note view.");
        }

        configure(leaf.view);
        workspace.setActiveLeaf(leaf, { focus: true });
        await workspace.revealLeaf(leaf);
    }

    // Open keyword view (includes sub-tags by default)
    async openKeywordView(keyword: KeywordConfig) {
        const target = this.getKeywordTarget(keyword);

        await this.openKeywordNoteView((view) => {
            view.setSelectionMode("tag", target);
            view.setTimeField("mtime");
            view.setIncludeSubTags(true);
            view.setKeywordDisplay(keyword);
        });
    }

    // Open sub-tag view (includeSubTags=true also includes deeper sub-tags)
    async openSubTagView(subTag: string, includeSubTags = false) {
        await this.openKeywordNoteView((view) => {
            view.setSelectionMode("tag", subTag);
            view.setTimeField("mtime");
            view.setIncludeSubTags(includeSubTags);
        });
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
        await this.openKeywordNoteView((view) => {
            view.setSelectionMode("folder", folder.path);
            view.setTimeField("mtime");
            view.setFolderDisplay(folder);
        });
    }

    async openTagView(tagName: string, timeField: TimeField = "mtime") {
        await this.openKeywordNoteView((view) => {
            view.setSelectionMode("tag", tagName);
            view.setTimeField(timeField);
        });
    }

    async openOverviewView(target: OverviewTarget) {
        await this.openKeywordNoteView((view) => {
            view.setSelectionMode("overview", target);
            view.setTimeField("mtime");
            view.setIncludeSubTags(false);
            view.setOverviewDisplay(target);
        });
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
        activeDocument.body.toggleClass(
            "keyword-notes-hide-frontmatter",
            this.settings.hideFrontmatter
        );
        activeDocument.body.toggleClass(
            "keyword-notes-hide-backlinks",
            this.settings.hideBacklinks
        );
        this.applyDefaultNoteColor();
    }

    applyDefaultNoteColor() {
        activeDocument.body.style.setProperty(
            "--keyword-notes-default-color",
            this.settings.defaultNoteColor || DEFAULT_NOTE_COLOR
        );
    }

    private getRandomNoteColor(filePath: string): string {
        const colors = NOTE_COLORS
            .map(color => color.value)
            .filter((value): value is string => typeof value === "string");

        if (colors.length === 0) return DEFAULT_NOTE_COLOR;

        let hash = 0;
        for (let i = 0; i < filePath.length; i++) {
            hash = (hash * 31 + filePath.charCodeAt(i)) >>> 0;
        }

        return colors[hash % colors.length];
    }

    patchWorkspace() {
        let layoutChanging = false;
        const wrapper = {
            getActiveViewOfType: (next: (...args: unknown[]) => unknown) =>
                function (this: Workspace, t: ViewConstructor) {
                    const fn = next as (this: Workspace, type: ViewConstructor, ...args: unknown[]) => ViewConstructor | null;
                    const result = Reflect.apply(fn, this, [t]);
                    if (!result) {
                        if (t?.VIEW_TYPE === "markdown") {
                            const recentLeaf = this.getMostRecentLeaf();
                            if (recentLeaf?.view instanceof KeywordNoteView) {
                                return recentLeaf.view.editMode;
                            } else {
                                return null;
                            }
                        }
                    }
                    return result;
                },
            changeLayout: (old: (...args: unknown[]) => unknown) =>
                async function (this: Workspace, workspace: unknown) {
                    layoutChanging = true;
                    try {
                        await old.call(this, workspace);
                    } finally {
                        layoutChanging = false;
                    }
                },
            iterateLeaves: (old: (...args: unknown[]) => unknown) =>
                function (this: Workspace, arg1: WorkspaceItem | LeafIterator, arg2?: LeafIterator) {
                    const oldFn = old as (this: Workspace, arg1: LeafIterator | WorkspaceItem, arg2?: LeafIterator) => boolean;
                    if (Reflect.apply(oldFn, this, [arg1, arg2]) as boolean) return true;

                    const cb = typeof arg1 === "function" ? arg1 : arg2;
                    const parent = typeof arg1 === "function" ? arg2 : arg1;
                    if (!cb) return false;
                    if (!parent) return false;
                    if (layoutChanging) return false;

                    if (!requireApiVersion("0.15.0") && parent === this.rootSplit) {
                        return KeywordNoteEditor.iteratePopoverLeaves(this, cb);
                    }

                    return false;
                },
            setActiveLeaf: (next: (...args: unknown[]) => unknown) =>
                function (this: Workspace, e: WorkspaceLeaf, t?: WorkspaceSetActiveParams) {
                    const setFn = next as (this: Workspace, leaf: WorkspaceLeaf, params?: WorkspaceSetActiveParams) => void;
                    const leaf = e as LeafWithParent;
                    const parentLeaf = leaf.parentLeaf;
                    if (parentLeaf) {
                        parentLeaf.activeTime = Date.now();
                        setFn.call(this, parentLeaf, t ?? {});
                        const editMode = (e.view as MarkdownViewLike)?.editMode;
                        if (editMode) {
                            this.activeEditor = e.view as unknown as MarkdownFileInfo;
                            if (parentLeaf.view) {
                                parentLeaf.view.editMode = e.view;
                            }
                        }
                        return;
                    }
                    setFn.call(this, e, t ?? {});
                    return;
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
                getRoot(old: (this: WorkspaceLeaf) => WorkspaceItem & { getRoot?: () => WorkspaceItem }) {
                    return function (this: WorkspaceLeaf) {
                        const root = Reflect.apply(old, this, []) as WorkspaceItem & { getRoot?: () => WorkspaceItem };
                        if (!isKeywordNoteLeaf(this)) return root;
                        const top = root;
                        return top?.getRoot === this.getRoot
                            ? top
                            : top?.getRoot() ?? top;
                    };
                },
                setPinned(old: (this: WorkspaceLeaf, pinned: boolean) => void) {
                    return function (this: WorkspaceLeaf, pinned: boolean) {
                        old.call(this, pinned);
                        if (isKeywordNoteLeaf(this) && !pinned)
                            this.setPinned(true);
                    };
                },
                openFile(old: (this: WorkspaceLeaf, file: TFile, openState?: OpenViewState) => Promise<void>) {
                    return function (this: WorkspaceLeaf, file: TFile, openState?: OpenViewState) {
                        return Reflect.apply(old, this, [file, openState]);
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
        const storedSettings = await this.loadData() as Partial<KeywordNotesSettings> | null;
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            storedSettings
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

    getNoteAccentColor(filePath: string): string | null {
        const noteColor = this.getNoteColor(filePath);
        if (noteColor) return noteColor;

        if (this.settings.useRandomNoteColors) {
            return this.getRandomNoteColor(filePath);
        }

        return null;
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
        const tagLower = tag.toLowerCase();
        const rootTag = tagLower.includes("/") ? tagLower.split("/")[0] : tagLower;
        const keyword = this.settings.keywords.find(k => {
            if (k.keywords && k.keywords.length > 0) {
                return k.keywords.some(kw => tagLower === kw || tagLower.startsWith(kw + "/"));
            }
            return tagLower === k.keyword || tagLower.startsWith(k.keyword + "/") || rootTag === k.keyword;
        });

        await this.openKeywordNoteView((view) => {
            view.setSelectionMode("tag", tagLower);
            view.setTimeField("mtime");
            view.setIncludeSubTags(true);
            if (keyword) {
                view.setKeywordDisplay(keyword);
            }
        });
    }
}
