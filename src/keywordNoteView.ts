import KeywordNotesPlugin from "./keywordNotesPlugin";
import {
    ViewStateResult,
    WorkspaceLeaf,
    ItemView,
    Scope,
    TAbstractFile,
    TFile,
} from "obsidian";
import { OverviewTarget, SelectionMode, TimeField } from "./types/time";
import KeywordNoteEditorViewComponent from "./component/KeywordNoteEditorView.svelte";
import type { KeywordConfig, FolderConfig } from "./keywordNoteSettings";

export const KEYWORD_NOTE_VIEW_TYPE = "keyword-notes-view";

export function isEmebeddedLeaf(leaf: WorkspaceLeaf) {
    // Work around missing enhance.js API by checking match condition instead of looking up parent
    return (leaf as unknown as { containerEl: HTMLElement }).containerEl.matches(".kw-leaf-view");
}

interface KeywordNoteEditorViewInstance {
    $destroy(): void;
    $set(props: Partial<{
        selectionMode: SelectionMode;
        target: string;
        timeField: TimeField;
        includeSubTags: boolean;
        showCue: boolean;
        showBody: boolean;
        showSummary: boolean;
        cornellCueWidth: number;
        xiaohongshuTopRightText: string;
        xiaohongshuBottomLeftText: string;
    }>): void;
    refresh(): void;
    fileCreate(file: TFile): void;
    fileDelete(file: TFile): void;
    fileRename(): void;
    foldAll(): void;
    expandAll(): void;
}

const KeywordNoteEditorViewCtor = KeywordNoteEditorViewComponent as unknown as new (options: {
    target: HTMLElement;
    props: {
        plugin: KeywordNotesPlugin;
        leaf: WorkspaceLeaf;
        selectionMode: SelectionMode;
        target: string;
        timeField: TimeField;
        includeSubTags: boolean;
        showCue: boolean;
        showBody: boolean;
        showSummary: boolean;
        cornellCueWidth: number;
        xiaohongshuTopRightText: string;
        xiaohongshuBottomLeftText: string;
    };
}) => KeywordNoteEditorViewInstance;

export class KeywordNoteView extends ItemView {
    view?: KeywordNoteEditorViewInstance;
    plugin: KeywordNotesPlugin;
    scope: Scope;
    editMode?: unknown;

    selectionMode: SelectionMode = "tag";
    target: string = "";
    timeField: TimeField = "mtime";
    includeSubTags: boolean = false;

    // 关键词显示配置
    keywordDisplay: KeywordConfig | null = null;

    // 文件夹显示配置
    folderDisplay: FolderConfig | null = null;

    // 小红书显示配置（沿用 FolderConfig 表达「指定目录」）
    xiaohongshuDisplay: FolderConfig | null = null;

    // 康奈尔显示配置
    cornellDisplay: KeywordConfig | null = null;

    // 康奈尔三列显隐（线索 / 正文 / 总结）
    showCue: boolean = true;
    showBody: boolean = true;
    showSummary: boolean = true;

    overviewDisplay: { target: OverviewTarget; alias: string; icon: string } | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: KeywordNotesPlugin) {
        super(leaf);
        this.plugin = plugin;

        this.showCue = plugin.settings.cornellShowCue !== false;
        this.showBody = plugin.settings.cornellShowBody !== false;
        this.showSummary = plugin.settings.cornellShowSummary !== false;

        this.scope = new Scope(plugin.app.scope);
    }

    /** Cornell zone visibility and cue width live in settings; push them into the view. */
    private syncCornellProps(): void {
        this.showCue = this.plugin.settings.cornellShowCue !== false;
        this.showBody = this.plugin.settings.cornellShowBody !== false;
        this.showSummary = this.plugin.settings.cornellShowSummary !== false;

        this.view?.$set({
            showCue: this.showCue,
            showBody: this.showBody,
            showSummary: this.showSummary,
            cornellCueWidth: this.plugin.settings.cornellCueWidth || 176,
        });
    }

    private syncXiaohongshuProps(): void {
        this.view?.$set({
            xiaohongshuTopRightText: this.plugin.settings.xiaohongshuTopRightText || "",
            xiaohongshuBottomLeftText: this.plugin.settings.xiaohongshuBottomLeftText || "",
        });
    }

    getMode = () => {
        return "source";
    };

    getViewType(): string {
        return KEYWORD_NOTE_VIEW_TYPE;
    }

    getDisplayText(): string {
        if (this.keywordDisplay) {
            return `${this.keywordDisplay.icon} ${this.keywordDisplay.alias}`;
        }
        if (this.folderDisplay) {
            return `${this.folderDisplay.icon} ${this.folderDisplay.alias}`;
        }
        if (this.cornellDisplay) {
            return `${this.cornellDisplay.icon} ${this.cornellDisplay.alias}`;
        }
        if (this.xiaohongshuDisplay) {
            return `🌸 ${this.xiaohongshuDisplay.alias}`;
        }
        if (this.overviewDisplay) {
            return `${this.overviewDisplay.icon} ${this.overviewDisplay.alias}`;
        }
        if (this.selectionMode === "tag" && this.target) {
            return `#${this.target}`;
        }
        if (this.selectionMode === "cornell" && this.target) {
            return `🌽 #${this.target}`;
        }
        if (this.selectionMode === "xiaohongshu" && this.target) {
            return `🌸 ${this.target}`;
        }
        if (this.selectionMode === "folder") {
            return `文件夹: ${this.target}`;
        }
        if (this.selectionMode === "overview") {
            if (this.target === "important-urgent") return "重要且紧急";
            if (this.target === "read-later") return "稍后读";
            if (this.target === "todo") return "待办事项";
            if (this.target === "today") return "今天";
            if (this.target.startsWith("recent:")) return "最近编辑";
            return "关键词笔记";
        }
        return "关键词笔记";
    }

    getIcon(): string {
        return "tag";
    }
    
    // 设置关键词显示
    setKeywordDisplay(keyword: KeywordConfig) {
        this.keywordDisplay = keyword;
        this.folderDisplay = null;
        this.cornellDisplay = null;
        this.overviewDisplay = null;
        this.leaf.updateHeader();
    }
    
    // 设置文件夹显示
    setFolderDisplay(folder: FolderConfig) {
        this.folderDisplay = folder;
        this.keywordDisplay = null;
        this.cornellDisplay = null;
        this.xiaohongshuDisplay = null;
        this.overviewDisplay = null;
        this.leaf.updateHeader();
    }

    // 设置小红书显示（沿用 FolderConfig 描述指定目录）
    setXiaohongshuDisplay(folder: FolderConfig) {
        this.xiaohongshuDisplay = folder;
        this.keywordDisplay = null;
        this.folderDisplay = null;
        this.cornellDisplay = null;
        this.overviewDisplay = null;
        this.leaf.updateHeader();
    }

    // 设置康奈尔显示
    setCornellDisplay(keyword: KeywordConfig) {
        this.cornellDisplay = keyword;
        this.keywordDisplay = null;
        this.folderDisplay = null;
        this.overviewDisplay = null;
        this.leaf.updateHeader();
    }

    setOverviewDisplay(target: OverviewTarget, alias?: string) {
        if (target === "important-urgent") {
            this.overviewDisplay = { target, alias: alias || "重要且紧急", icon: "🔥" };
        } else if (target === "todo") {
            this.overviewDisplay = { target, alias: alias || "待办事项", icon: "☑️" };
        } else if (target.startsWith("recent:")) {
            this.overviewDisplay = { target, alias: alias || "最近编辑", icon: "🕘" };
        } else if (target === "read-later") {
            this.overviewDisplay = { target, alias: alias || "稍后读", icon: "📖" };
        } else {
            this.overviewDisplay = { target, alias: alias || "今天", icon: "📅" };
        }
        this.keywordDisplay = null;
        this.folderDisplay = null;
        this.cornellDisplay = null;
        this.leaf.updateHeader();
    }

    onFileCreate = (file: TAbstractFile) => {
        if (file instanceof TFile) this.view?.fileCreate(file);
    };

    onFileDelete = (file: TAbstractFile) => {
        if (file instanceof TFile) this.view?.fileDelete(file);
    };

    onFileRename = (file: TAbstractFile, oldPath: string) => {
        void oldPath;
        if (file instanceof TFile) this.view?.fileRename();
    };

    setSelectionMode(mode: SelectionMode, target: string = "") {
        this.selectionMode = mode;
        this.target = target;
        this.keywordDisplay = null;
        this.folderDisplay = null;
        this.cornellDisplay = null;
        this.xiaohongshuDisplay = null;
        this.overviewDisplay = null;

        if (this.view) {
            this.view.$set({
                selectionMode: mode,
                target: target,
            });
        }

        this.leaf.updateHeader();
    }

    setIncludeSubTags(value: boolean) {
        this.includeSubTags = value;
        if (this.view) {
            this.view.$set({ includeSubTags: value });
        }
    }

    refresh() {
        if (this.view) {
            this.syncCornellProps();
            this.syncXiaohongshuProps();
            this.view.refresh();
        }
    }



    getState(): Record<string, unknown> {
        const state = super.getState();

        return {
            ...state,
            selectionMode: this.selectionMode,
            target: this.target,
            timeField: this.timeField,
            includeSubTags: this.includeSubTags,
        };
    }

    /** Clean the xiaohongshu-related state when restoring into a non-xiaohongshu mode. */
    private syncDisplayFromMode(): void {
        if (this.selectionMode !== "xiaohongshu" && this.xiaohongshuDisplay) {
            this.xiaohongshuDisplay = null;
        }
        if (this.selectionMode !== "folder" && this.folderDisplay && this.selectionMode !== "xiaohongshu") {
            this.folderDisplay = null;
        }
        if (this.selectionMode !== "cornell" && this.cornellDisplay) {
            this.cornellDisplay = null;
        }
        if (this.selectionMode !== "tag" && this.keywordDisplay) {
            this.keywordDisplay = null;
        }
        if (this.selectionMode !== "overview" && this.overviewDisplay) {
            this.overviewDisplay = null;
        }
    }

    async setState(state: unknown, result?: unknown): Promise<void> {
        await super.setState(state, result as ViewStateResult);
        // Restore workspace state (e.g. after Obsidian restart)
        if (state && typeof state === "object") {
            const customState = state as {
                selectionMode?: SelectionMode;
                target?: string;
                timeField?: TimeField;
                includeSubTags?: boolean;
            };

            if (customState.selectionMode)
                this.selectionMode = customState.selectionMode;
            if (customState.target) this.target = customState.target;
            if (customState.timeField) this.timeField = customState.timeField;
            if (customState.includeSubTags !== undefined)
                this.includeSubTags = customState.includeSubTags;
            if (
                this.selectionMode === "overview" &&
                (
                    this.target === "today" ||
                    this.target === "important-urgent" ||
                    this.target === "todo" ||
                    this.target === "read-later" ||
                    this.target.startsWith("recent:")
                )
            ) {
                this.setOverviewDisplay(this.target as OverviewTarget);
            }

            // 切换 selectionMode 后清理掉不匹配的显示状态
            this.syncDisplayFromMode();

            // View is created in onOpen(); update its props if already mounted
            if (this.view) {
                this.view.$set({
                    selectionMode: this.selectionMode,
                    target: this.target,
                    timeField: this.timeField,
                    includeSubTags: this.includeSubTags,
                    showCue: this.showCue,
                    showBody: this.showBody,
                    showSummary: this.showSummary,
                    cornellCueWidth: this.plugin.settings.cornellCueWidth || 176,
                });
            }
        }
    }

    setTimeField(field: TimeField) {
        this.timeField = field;
        if (this.view) {
            this.view.$set({ timeField: field });
        }
    }

    // openKeywordNoteEditor() {
    //     this.plugin.openKeywordNoteEditor();
    // }

    async onOpen(): Promise<void> {
        this.scope.register(["Mod"], "f", (_e) => {
            void _e;
        });

        // 折叠所有笔记
        this.addAction("chevron-down", "折叠所有笔记", () => {
            if (this.view) {
                this.view.foldAll();
            }
        });

        // 展开所有笔记
        this.addAction("chevron-up", "展开所有笔记", () => {
            if (this.view) {
                this.view.expandAll();
            }
        });

        this.addAction("refresh", "Refresh", () => {
            if (this.view) {
                this.view.refresh();
            }
        });

        this.registerEvent(this.app.vault.on("create", this.onFileCreate));
        this.registerEvent(this.app.vault.on("delete", this.onFileDelete));
        this.registerEvent(this.app.vault.on("rename", this.onFileRename));

        // Create Svelte view here so it exists regardless of how the view is opened
        if (!this.view) {
            // Drop any DOM left behind by a previous plugin instance (dev reload with
            // the tab still open), otherwise the old and new UI stack up together.
            this.contentEl.empty();

            this.view = new KeywordNoteEditorViewCtor({
                target: this.contentEl,
                props: {
                    plugin: this.plugin,
                    leaf: this.leaf,
                    selectionMode: this.selectionMode,
                    target: this.target,
                    timeField: this.timeField,
                    includeSubTags: this.includeSubTags,
                    showCue: this.showCue,
                    showBody: this.showBody,
                    showSummary: this.showSummary,
                    cornellCueWidth: this.plugin.settings.cornellCueWidth || 176,
                    xiaohongshuTopRightText: this.plugin.settings.xiaohongshuTopRightText || "",
                    xiaohongshuBottomLeftText: this.plugin.settings.xiaohongshuBottomLeftText || "",
                },
            });
            this.app.workspace.onLayoutReady(() => {
                if (this.view) this.view.refresh();
            });
            this.registerInterval(
                window.setInterval(() => {
                    if (this.view) this.view.refresh();
                }, 1000 * 60 * 60)
            );
        }
    }

    async onClose(): Promise<void> {
        this.view?.$destroy();
        this.view = undefined;
        this.contentEl.empty();
    }
}
