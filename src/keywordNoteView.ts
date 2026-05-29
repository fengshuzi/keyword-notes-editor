import KeywordNotesPlugin from "./keywordNotesPlugin";
import {
    ViewStateResult,
    WorkspaceLeaf,
    ItemView,
    Scope,
    TAbstractFile,
    TFile,
    Menu,
    Modal,
    App,
    ButtonComponent,
} from "obsidian";
import { TimeRange, TimeField } from "./types/time";
import KeywordNoteEditorView from "./component/KeywordNoteEditorView.svelte";
import type { KeywordConfig, FolderConfig } from "./keywordNoteSettings";

export const KEYWORD_NOTE_VIEW_TYPE = "keyword-notes-view";

export function isEmebeddedLeaf(leaf: WorkspaceLeaf) {
    // Work around missing enhance.js API by checking match condition instead of looking up parent
    return (leaf as unknown as { containerEl: HTMLElement }).containerEl.matches(".kw-leaf-view");
}

export class KeywordNoteView extends ItemView {
    view: KeywordNoteEditorView;
    plugin: KeywordNotesPlugin;
    scope: Scope;

    selectedDaysRange: TimeRange = "all";
    selectionMode: "folder" | "tag" = "tag";
    target: string = "";
    timeField: TimeField = "mtime";
    includeSubTags: boolean = false;
    
    // 关键词显示配置
    keywordDisplay: KeywordConfig | null = null;
    
    // 文件夹显示配置
    folderDisplay: FolderConfig | null = null;

    customRange: {
        start: Date;
        end: Date;
    } | null = null;

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
        if (this.selectionMode === "tag" && this.target) {
            return `Tag: ${this.target}`;
        }
        if (this.selectionMode === "folder") {
            return `文件夹: ${this.target}`;
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
        this.leaf.updateHeader();
    }
    
    // 设置文件夹显示
    setFolderDisplay(folder: FolderConfig) {
        this.folderDisplay = folder;
        this.keywordDisplay = null;
        this.leaf.updateHeader();
    }

    onFileCreate = (file: TAbstractFile) => {
        if (file instanceof TFile) this.view.fileCreate(file);
    };

    onFileDelete = (file: TAbstractFile) => {
        if (file instanceof TFile) this.view.fileDelete(file);
    };

    setSelectedRange(range: TimeRange) {
        this.selectedDaysRange = range;
        if (this.view) {
            if (range === "custom") {
                this.view.$set({
                    selectedRange: range,
                    customRange: this.customRange,
                });
            } else {
                this.view.$set({ selectedRange: range });
            }
        }
    }

    setSelectionMode(mode: "folder" | "tag", target: string = "") {
        this.selectionMode = mode;
        this.target = target;

        if (this.view) {
            this.view.$set({
                selectionMode: mode,
                target: target,
            });
        }
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
            selectedRange: this.selectedDaysRange,
            customRange: this.customRange,
            includeSubTags: this.includeSubTags,
        };
    }

    async setState(state: unknown, result?: unknown): Promise<void> {
        await super.setState(state, result as ViewStateResult);
        // Handle our custom state properties if they exist
        if (state && typeof state === "object" && !this.view) {
            const customState = state as {
                selectionMode?: "folder" | "tag";
                target?: string;
                timeField?: TimeField;
                selectedRange?: TimeRange;
                customRange?: { start: Date; end: Date } | null;
                includeSubTags?: boolean;
            };

            if (customState.selectionMode)
                this.selectionMode = customState.selectionMode;
            if (customState.target) this.target = customState.target;
            if (customState.timeField) this.timeField = customState.timeField;
            if (customState.selectedRange)
                this.selectedDaysRange = customState.selectedRange;
            if (customState.customRange)
                this.customRange = customState.customRange;
            if (customState.includeSubTags !== undefined)
                this.includeSubTags = customState.includeSubTags;

            this.view = new KeywordNoteEditorView({
                target: this.contentEl,
                props: {
                    plugin: this.plugin,
                    leaf: this.leaf,
                    selectedRange: this.selectedDaysRange,
                    customRange: this.customRange,
                    selectionMode: this.selectionMode,
                    target: this.target,
                    timeField: this.timeField,
                    includeSubTags: this.includeSubTags,
                },
            });

            this.app.workspace.onLayoutReady(this.view.tick.bind(this));

            this.registerInterval(
                window.setInterval(async () => {
                    this.view.check();
                }, 1000 * 60 * 60)
            );
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
        this.scope.register(["Mod"], "f", (e) => {
            // do-nothing
        });

        // 修复：空格键事件从嵌入的 CodeMirror 编辑器冒泡上来时，
        // 会被 Obsidian 全局滚动/命令系统拦截，导致无法在编辑器内输入空格。
        // 在 capture 阶段检测到事件源是编辑器内容区时，阻止继续冒泡。
        this.contentEl.addEventListener('keydown', (evt) => {
            if ((evt.target as Element)?.closest('.cm-content, .cm-line')) {
                evt.stopPropagation();
            }
        }, true);


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

        this.addAction("calendar-range", "Select date range", (e) => {
            const menu = new Menu();
            // Add range selection options
            const addRangeOption = (title: string, range: TimeRange) => {
                menu.addItem((item) => {
                    item.setTitle(title);
                    item.setChecked(this.selectedDaysRange === range);
                    item.onClick(() => {
                        this.setSelectedRange(range);
                    });
                });
            };

            addRangeOption("All Notes", "all");
            addRangeOption("This Week", "week");
            addRangeOption("This Month", "month");
            addRangeOption("This Year", "year");
            addRangeOption("Last Week", "last-week");
            addRangeOption("Last Month", "last-month");
            addRangeOption("Last Year", "last-year");
            addRangeOption("This Quarter", "quarter");
            addRangeOption("Last Quarter", "last-quarter");

            menu.addSeparator();
            menu.addItem((item) => {
                item.setTitle("Custom Date Range");
                item.setChecked(this.selectedDaysRange === "custom");
                item.onClick(() => {
                    const modal = new CustomRangeModal(this.app, (range) => {
                        this.customRange = range;
                        this.setSelectedRange("custom");
                    });
                    modal.open();
                });
            });

            menu.showAtMouseEvent(e as MouseEvent);
        });

        this.addAction("refresh", "Refresh", () => {
            if (this.view) {
                this.view.check();

                // Update the view to get the latest files
                this.view.tick();

                // Force a refresh of the file list
                this.view.$set({
                    selectedRange: this.selectedDaysRange,
                    customRange: this.customRange,
                });
            }
        });

        this.app.vault.on("create", this.onFileCreate);
        this.app.vault.on("delete", this.onFileDelete);
    }


}

class CustomRangeModal extends Modal {
    saveCallback: (range: { start: Date; end: Date }) => void;
    startDate: Date;
    endDate: Date;

    constructor(
        app: App,
        saveCallback: (range: { start: Date; end: Date }) => void
    ) {
        super(app);
        this.saveCallback = saveCallback;
        this.startDate = new Date();
        this.endDate = new Date();
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl("h2", { text: "Select Custom Date Range" });

        const startDateContainer = contentEl.createEl("div", {
            cls: "custom-range-date-container",
        });
        startDateContainer.createEl("span", { text: "Start Date: " });
        const startDatePicker = startDateContainer.createEl("input", {
            type: "date",
            value: this.formatDate(this.startDate),
        });
        startDatePicker.addEventListener("change", (e) => {
            this.startDate = new Date((e.target as HTMLInputElement).value);
        });

        const endDateContainer = contentEl.createEl("div", {
            cls: "custom-range-date-container",
        });
        endDateContainer.createEl("span", { text: "End Date: " });
        const endDatePicker = endDateContainer.createEl("input", {
            type: "date",
            value: this.formatDate(this.endDate),
        });
        endDatePicker.addEventListener("change", (e) => {
            this.endDate = new Date((e.target as HTMLInputElement).value);
        });

        const buttonContainer = contentEl.createEl("div", {
            cls: "custom-range-button-container",
        });

        new ButtonComponent(buttonContainer)
            .setButtonText("Cancel")
            .onClick(() => {
                this.close();
            });

        new ButtonComponent(buttonContainer)
            .setButtonText("Confirm")
            .setCta()
            .onClick(() => {
                this.saveCallback({
                    start: this.startDate,
                    end: this.endDate,
                });
                this.close();
            });
    }

    formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    onClose() {
        this.contentEl.empty();
    }
}

