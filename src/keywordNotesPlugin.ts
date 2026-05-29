import {
    Plugin,
    OpenViewState,
    TFile,
    Workspace,
    WorkspaceContainer,
    WorkspaceItem,
    WorkspaceLeaf,
    getAllTags,
    requireApiVersion,
} from "obsidian";

import { around } from "monkey-around";
import { KeywordNoteEditor, isKeywordNoteLeaf } from "./leafView";
import "./style/index.css";
import { addIconList } from "./utils/icon";
import {
    KeywordNotesSettings,
    KeywordNotesSettingTab,
    DEFAULT_SETTINGS,
    KeywordConfig,
    FolderConfig,
} from "./keywordNoteSettings";
import { TimeField, SelectionMode } from "./types/time";
import { createUpDownNavigationExtension } from "./component/UpAndDownNavigate";
import { KEYWORD_NOTE_VIEW_TYPE, KeywordNoteView } from "./keywordNoteView";
import { KEYWORD_LIST_VIEW_TYPE, KeywordListView } from "./keywordListView";

export default class KeywordNotesPlugin extends Plugin {
    private view: KeywordNoteView;
    private keywordListView: KeywordListView;
    lastActiveFile: TFile;

    declare settings: KeywordNotesSettings;
    

    async onload() {
        this.addSettingTab(new KeywordNotesSettingTab(this.app, this));
        await this.loadSettings();
        this.patchWorkspace();
        this.patchWorkspaceLeaf();
        addIconList();

        // Register the up and down navigation extension
        this.settings.useArrowUpOrDownToNavigate &&
            this.registerEditorExtension([
                createUpDownNavigationExtension({
                    app: this.app,
                    plugin: this,
                }),
            ]);

        this.registerView(
            KEYWORD_NOTE_VIEW_TYPE,
            (leaf: WorkspaceLeaf) => (this.view = new KeywordNoteView(leaf, this))
        );

        // Register keyword list sidebar view
        this.registerView(
            KEYWORD_LIST_VIEW_TYPE,
            (leaf: WorkspaceLeaf) => (this.keywordListView = new KeywordListView(leaf, this))
        );

        this.initCssRules();

        // Open keyword list sidebar by default
        this.app.workspace.onLayoutReady(() => {
            if (this.settings.openKeywordListOnStartup) {
                this.activateKeywordListView();
            }
        });
    }

    onunload() {
        document.body.toggleClass("keyword-notes-hide-frontmatter", false);
        document.body.toggleClass("keyword-notes-hide-backlinks", false);
    }

    // Activate keyword list sidebar
    async activateKeywordListView() {
        const { workspace } = this.app;
        
        let leaf = workspace.getLeavesOfType(KEYWORD_LIST_VIEW_TYPE)[0];
        
        if (!leaf) {
            // 在左侧边栏创建视图
            const leftLeaf = workspace.getLeftLeaf(false);
            if (leftLeaf) {
                await leftLeaf.setViewState({
                    type: KEYWORD_LIST_VIEW_TYPE,
                    active: true,
                });
                leaf = leftLeaf;
            }
        }
        
        if (leaf) {
            workspace.revealLeaf(leaf);
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



    // Get keyword target (single tag is keyword, aggregation is p1+p2+p3+p4)
    private getKeywordTarget(keyword: KeywordConfig): string {
        if (keyword.keywords && keyword.keywords.length > 0) {
            return keyword.keywords.join("+");
        }
        return keyword.keyword;
    }

    // Open keyword view (includes sub-tags by default)
    async openKeywordView(keyword: KeywordConfig) {
        const workspace = this.app.workspace;
        const target = this.getKeywordTarget(keyword);

        // 检查是否已存在相同的视图
        const existingLeaves = workspace.getLeavesOfType(KEYWORD_NOTE_VIEW_TYPE);
        for (const leaf of existingLeaves) {
            const view = leaf.view as KeywordNoteView;
            if (view.selectionMode === "tag" && view.target === target) {
                // 已存在，激活并强制刷新数据（避免 metadataCache 未就绪时的空数据缓存）
                workspace.revealLeaf(leaf);
                view.refresh();
                return;
            }
        }

        // 不存在，创建新视图
        const leaf = workspace.getLeaf(true);
        await leaf.setViewState({ type: KEYWORD_NOTE_VIEW_TYPE });

        // 获取视图并设置为标签模式，始终包含子标签
        const view = leaf.view as KeywordNoteView;
        view.setSelectionMode("tag", target);
        view.setTimeField("mtime"); // 按修改时间倒序
        view.setIncludeSubTags(true);
        view.setKeywordDisplay(keyword);

        workspace.revealLeaf(leaf);
    }

    // Open sub-tag view (includeSubTags=true also includes deeper sub-tags)
    async openSubTagView(subTag: string, includeSubTags = false) {
        const workspace = this.app.workspace;

        const existingLeaves = workspace.getLeavesOfType(KEYWORD_NOTE_VIEW_TYPE);
        for (const leaf of existingLeaves) {
            const view = leaf.view as KeywordNoteView;
            if (view.selectionMode === "tag" && view.target === subTag && view.includeSubTags === includeSubTags) {
                workspace.revealLeaf(leaf);
                return;
            }
        }

        const leaf = workspace.getLeaf(true);
        await leaf.setViewState({ type: KEYWORD_NOTE_VIEW_TYPE });

        const view = leaf.view as KeywordNoteView;
        view.setSelectionMode("tag", subTag);
        view.setTimeField("mtime");
        view.setIncludeSubTags(includeSubTags);

        workspace.revealLeaf(leaf);
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
        const workspace = this.app.workspace;
        
        // 检查是否已存在相同的视图
        const existingLeaves = workspace.getLeavesOfType(KEYWORD_NOTE_VIEW_TYPE);
        for (const leaf of existingLeaves) {
            const view = leaf.view as KeywordNoteView;
            if (view.selectionMode === "folder" && view.target === folder.path) {
                // 已存在，直接激活
                workspace.revealLeaf(leaf);
                return;
            }
        }
        
        // 不存在，创建新视图
        const leaf = workspace.getLeaf(true);
        await leaf.setViewState({ type: KEYWORD_NOTE_VIEW_TYPE });

        // 获取视图并设置为文件夹模式
        const view = leaf.view as KeywordNoteView;
        view.setSelectionMode("folder", folder.path);
        view.setTimeField("mtime"); // 按修改时间倒序
        view.setFolderDisplay(folder);

        workspace.revealLeaf(leaf);
    }

    async openTagView(tagName: string, timeField: TimeField = "mtime") {
        const workspace = this.app.workspace;
        const leaf = workspace.getLeaf(true);
        await leaf.setViewState({ type: KEYWORD_NOTE_VIEW_TYPE });

        const view = leaf.view as KeywordNoteView;
        view.setSelectionMode("tag", tagName);
        view.setTimeField(timeField);

        workspace.revealLeaf(leaf);
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
    }

    patchWorkspace() {
        let layoutChanging = false;
        const wrapper = {
            getActiveViewOfType: (next: (...args: unknown[]) => unknown) =>
                function (this: unknown, t: unknown) {
                    const fn = next as (type: { VIEW_TYPE?: string }, ...args: unknown[]) => { VIEW_TYPE?: string } | null;
                    const result = fn(t as { VIEW_TYPE?: string });
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
            recordMostRecentOpenedFile: (old: (...args: unknown[]) => unknown) =>
                function (this: unknown, file: unknown) {
                    // no-op
                },
            setActiveLeaf: (next: (...args: unknown[]) => unknown) =>
                function (this: unknown, e: unknown, t?: unknown) {
                    const setFn = next as (leaf: WorkspaceLeaf, params?: { focus?: boolean } | boolean) => void;
                    const leaf = e as unknown as { parentLeaf?: WorkspaceLeaf & { activeTime?: number; view?: { editMode?: unknown } } };
                    if (leaf.parentLeaf) {
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
                        if (isKeywordNoteLeaf(this)) {
                            setTimeout(
                                around(Workspace.prototype, {
                                    recordMostRecentOpenedFile(old) {
                                        return function (_file: TFile) {
                                            if (_file !== file) {
                                                return old.call(this, _file);
                                            }
                                        };
                                    },
                                }),
                                1
                            );
                            const recentFiles =
                                this.app.plugins.plugins[
                                    "recent-files-obsidian"
                                ];
                            if (recentFiles)
                                setTimeout(
                                    around(recentFiles, {
                                        shouldAddFile(old) {
                                            return function (_file: TFile) {
                                                return (
                                                    _file !== file &&
                                                    old.call(this, _file)
                                                );
                                            };
                                        },
                                    }),
                                    1
                                );
                        }
                        return old.call(this, file, openState);
                    };
                },
            })
        );
    }

    public async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );
        
        // Reassign icons to ensure keywords and folders do not have duplicate icons
        this.reassignIcons();
    }
    
    // Reassign icons to avoid duplicates
    private reassignIcons() {
        const FRUIT_ICONS = ['🍎', '🍏', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🌽', '🥕', '🥦', '🌰'];
        
        // 收集已使用的自定义图标
        const usedIcons = new Set<string>();
        
        // 先处理有自定义图标的项
        this.settings.keywords.forEach(k => {
            if (k.icon && FRUIT_ICONS.includes(k.icon)) {
                // 检查是否是用户手动设置的（通过配置字符串中是否有第三个参数判断）
                // 这里简化处理：如果图标在列表中，先标记为已使用
            }
        });
        
        // 为关键词分配图标
        let iconIndex = 0;
        this.settings.keywords.forEach((k, index) => {
            // 如果没有自定义图标，分配一个
            if (!k.icon || FRUIT_ICONS.includes(k.icon)) {
                k.icon = FRUIT_ICONS[iconIndex % FRUIT_ICONS.length];
                iconIndex++;
            }
        });
        
        // 为文件夹分配图标（从关键词之后继续）
        this.settings.folders.forEach((f, index) => {
            if (!f.icon || FRUIT_ICONS.includes(f.icon)) {
                f.icon = FRUIT_ICONS[iconIndex % FRUIT_ICONS.length];
                iconIndex++;
            }
        });
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
