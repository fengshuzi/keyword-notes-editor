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
    $set(props: Partial<{
        selectionMode: SelectionMode;
        target: string;
        timeField: TimeField;
        includeSubTags: boolean;
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

    overviewDisplay: { target: OverviewTarget; alias: string; icon: string } | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: KeywordNotesPlugin) {
        super(leaf);
        this.plugin = plugin;

        this.scope = new Scope(plugin.app.scope);
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
        if (this.overviewDisplay) {
            return `${this.overviewDisplay.icon} ${this.overviewDisplay.alias}`;
        }
        if (this.selectionMode === "tag" && this.target) {
            return `#${this.target}`;
        }
        if (this.selectionMode === "folder") {
            return `文件夹: ${this.target}`;
        }
        if (this.selectionMode === "overview") {
            if (this.target === "important-urgent") return "重要且紧急";
            if (this.target === "tasks") return "待办事项";
            if (this.target === "read-later") return "稍后读";
            return "今天";
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
        this.overviewDisplay = null;
        this.leaf.updateHeader();
    }
    
    // 设置文件夹显示
    setFolderDisplay(folder: FolderConfig) {
        this.folderDisplay = folder;
        this.keywordDisplay = null;
        this.overviewDisplay = null;
        this.leaf.updateHeader();
    }

    setOverviewDisplay(target: OverviewTarget) {
        if (target === "important-urgent") {
            this.overviewDisplay = { target, alias: "重要且紧急", icon: "🔥" };
        } else if (target === "tasks") {
            this.overviewDisplay = { target, alias: "待办事项", icon: "☑️" };
        } else if (target === "read-later") {
            this.overviewDisplay = { target, alias: "稍后读", icon: "📖" };
        } else {
            this.overviewDisplay = { target, alias: "今天", icon: "📅" };
        }
        this.keywordDisplay = null;
        this.folderDisplay = null;
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
                    this.target === "tasks" ||
                    this.target === "read-later"
                )
            ) {
                this.setOverviewDisplay(this.target);
            }

            // View is created in onOpen(); update its props if already mounted
            if (this.view) {
                this.view.$set({
                    selectionMode: this.selectionMode,
                    target: this.target,
                    timeField: this.timeField,
                    includeSubTags: this.includeSubTags,
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
            this.view = new KeywordNoteEditorViewCtor({
                target: this.contentEl,
                props: {
                    plugin: this.plugin,
                    leaf: this.leaf,
                    selectionMode: this.selectionMode,
                    target: this.target,
                    timeField: this.timeField,
                    includeSubTags: this.includeSubTags,
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


}
