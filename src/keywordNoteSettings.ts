import KeywordNotesPlugin from "./keywordNotesPlugin";
import { App, Platform, PluginSettingTab, Setting, SettingDefinitionItem, setIcon } from "obsidian";

// Keyword configuration interface (supports aggregation: p1+p2+p3+p4|Quadrant, matches any one tag)
export interface KeywordConfig {
    keyword: string;   // Primary keyword (the tag to match for single tag; first tag for aggregation)
    alias: string;     // Display alias
    icon: string;      // Display icon
    keywords?: string[]; // Multiple keywords for aggregation, matches any one
}

// Folder configuration interface
export interface FolderConfig {
    path: string;     // Folder path (supports multi-level paths like folder/subfolder)
    alias: string;    // Display alias
    icon: string;     // Display icon
}

// Sidebar entry types shown in the keyword list
export type SidebarEntryType = "doc" | "keyword" | "folder" | "recent" | "todo";

// Unified sidebar entry. For "recent", value is "yesterday" or a day count N
// (including today, counting back N calendar days). "todo" needs no value.
export interface SidebarEntry {
    type: SidebarEntryType;
    /** Display name shown in the sidebar */
    alias: string;
    /** Keyword spec ("a" or "a+b"), folder path, recent value, or "" for todo */
    value: string;
    icon: string;
}

export type MobileNoteMode = "editable" | "preview";

export interface KeywordNotesSettings {
    createAndOpenOnStartup: boolean;
    openKeywordListOnStartup: boolean;  // Do not auto-open keyword list by default
    mobileNoteMode: MobileNoteMode;

    // Keyword configuration (legacy, migrated into sidebarEntries)
    keywords: KeywordConfig[];
    
    // Folder configuration (legacy, migrated into sidebarEntries)
    folders: FolderConfig[];

    /** Custom sidebar entries rendered in the keyword list, in display order */
    sidebarEntries?: SidebarEntry[];

    preset: {
        type: "folder" | "tag";
        target: string;
    }[];

    /** Folders to exclude from keyword scanning (e.g. journals) */
    excludedFolders: string[];

    /** Folder path for new pages created from keyword right-click menu */
    newPageFolder: string;

    /** Journal folders used by the Today overview */
    journalFolders: string[];

    /** Pinned note paths grouped by keyword/folder view scope */
    pinnedNotes: Record<string, string[]>;

    /** Per-note color overrides: file path -> hex color string */
    noteColors: Record<string, string>;

    /** Default accent color for notes without a per-note override */
    defaultNoteColor: string;

    /** Use a stable random common color when a note does not have a per-note override */
    useRandomNoteColors: boolean;
}

// Fruit icon list (shared by keywords and folders)
const FRUIT_ICONS = [
    // 水果
    '🍎', '🍏', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐',
    '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅',
    // 蔬菜
    '🥑', '🍆', '🥔', '🍠', '🌽', '🥕', '🫒', '🌶️', '🫑', '🥒',
    '🥬', '🥦', '🧄', '🧅', '🍄', '🌰',
];

// Type metadata for the sidebar entry dropdown
export const ENTRY_TYPE_META: Record<SidebarEntryType, { label: string }> = {
    doc: { label: "📄 文档" },
    keyword: { label: "🏷 关键词" },
    folder: { label: "📁 文件夹" },
    recent: { label: "🕒 最近编辑" },
    todo: { label: "✅ 待办事项" },
};

// Preset choices for the "recent" entry type
export const RECENT_PRESETS: Record<string, string> = {
    yesterday: "昨天（仅昨天 0-24 点）",
    "1": "最近 1 天",
    "2": "最近 2 天",
    "3": "最近 3 天",
    "7": "最近 7 天",
};

export const DEFAULT_NOTE_COLOR = "#ffb000";

export const DEFAULT_SETTINGS: KeywordNotesSettings = {
    createAndOpenOnStartup: false,
    openKeywordListOnStartup: false,  // Do not auto-open keyword list by default
    mobileNoteMode: "editable",
    keywords: [],
    folders: [],
    sidebarEntries: [],
    preset: [],
    excludedFolders: [],
    newPageFolder: "pages",
    journalFolders: ["journals"],
    pinnedNotes: {},
    noteColors: {},
    defaultNoteColor: DEFAULT_NOTE_COLOR,
    useRandomNoteColors: false,
};

export const NOTE_COLORS: Array<{ label: string; value: string | null }> = [
    { label: "🔴 红色",  value: "#ff6b6b" },
    { label: "🟠 橙色",  value: "#ff9f43" },
    { label: "🟡 黄色",  value: "#ffd43b" },
    { label: "🟢 绿色",  value: "#51cf66" },
    { label: "🔵 蓝色",  value: "#339af0" },
    { label: "🟣 紫色",  value: "#cc5de8" },
    { label: "🩷 粉色",  value: "#f06595" },
    { label: "🟤 棕色",  value: "#a0856c" },
    { label: "⬛ 灰色",  value: "#868e96" },
    { label: "⊘ 无",    value: null },
];

// Parse keyword configuration string (supports aggregation: p1+p2+p3+p4|Quadrant)
export function parseKeywordsString(str: string, startIndex: number = 0): KeywordConfig[] {
    if (!str.trim()) return [];

    return str.split(',').map((item, index) => {
        const parts = item.trim().split('|');
        const keywordSpec = parts[0]?.trim().replace(/^#/, '') || '';
        const alias = parts[1]?.trim() || '';
        const icon = parts[2]?.trim() || FRUIT_ICONS[(startIndex + index) % FRUIT_ICONS.length];

        const rawKeywords = keywordSpec.split('+').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
        if (rawKeywords.length === 0) return null;

        const keyword = rawKeywords[0];
        const keywords = rawKeywords.length > 1 ? rawKeywords : undefined;
        const finalAlias = alias || (rawKeywords.length > 1 ? rawKeywords.join('+') : keyword);

        const config: KeywordConfig = { keyword, alias: finalAlias, icon };
        if (keywords !== undefined) config.keywords = keywords;
        return config;
    }).filter((k): k is KeywordConfig => k !== null);
}

// Parse folder configuration string
export function parseFoldersString(str: string, startIndex: number = 0): FolderConfig[] {
    if (!str.trim()) return [];
    
    return str.split(',').map((item, index) => {
        const parts = item.trim().split('|');
        // Path keeps original case, no toLowerCase conversion
        const path = parts[0]?.trim() || '';
        // Default alias is the last part of the path
        const defaultAlias = path.split('/').pop() || path;
        const alias = parts[1]?.trim() || defaultAlias;
        const icon = parts[2]?.trim() || FRUIT_ICONS[(startIndex + index) % FRUIT_ICONS.length];
        return { path, alias, icon };
    }).filter(f => f.path);
}

/** Convert a sidebar entry back to the legacy KeywordConfig shape (keyword entries) */
export function entryToKeywordConfig(entry: SidebarEntry): KeywordConfig {
    const parsed = parseKeywordsString(`${entry.value}|${entry.alias}|${entry.icon}`);
    return parsed[0] ?? { keyword: entry.value, alias: entry.alias, icon: entry.icon };
}

/** Convert a sidebar entry back to the legacy FolderConfig shape (folder entries) */
export function entryToFolderConfig(entry: SidebarEntry): FolderConfig {
    return { path: entry.value, alias: entry.alias, icon: entry.icon };
}

export class KeywordNotesSettingTab extends PluginSettingTab {
    plugin: KeywordNotesPlugin;
    private entriesEl!: HTMLElement;

    constructor(app: App, plugin: KeywordNotesPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        // The whole tab is imperative; expose it through one render item so
        // the tab adopts the 1.13 declarative API (settings search indexing)
        // without rewriting every control.
        return [
            {
                type: "group",
                cls: "kw-settings-root",
                items: [
                    {
                        name: "Keyword Notes settings",
                        searchable: false,
                        render: (setting, group) => {
                            setting.settingEl.addClass("kw-hidden");
                            group.listEl.empty();
                            this.buildSettings(group.listEl);
                        },
                    },
                ],
            },
        ];
    }

    private buildSettings(rootEl: HTMLElement): void {
        // Sidebar custom entries
        const entriesCard = rootEl.createDiv({ cls: "kw-settings-card" });
        new Setting(entriesCard).setName("侧边栏自定义菜单").setHeading();
        const descEl = entriesCard.createEl("p", { cls: "kw-entries-desc" });
        descEl.setText("类型说明：📄 文档 = 固定笔记路径（点击打开，首次自动创建）；🏷 关键词 = 按标签过滤，聚合用 + 连接（如 p1+p2），支持嵌套标签（p1 命中 #p1/web）；📁 文件夹 = 按路径前缀过滤（如 projects/work）；🕒 最近编辑 = 「昨天」仅含昨天 0-24 点编辑过的笔记，「最近 N 天」含今天在内向前 N 个自然日；✅ 待办事项 = 包含未完成任务（- [ ]）的笔记，无需填写值。拖动 ☰ 可调整顺序。");
        this.entriesEl = entriesCard.createDiv({ cls: "kw-entries-list" });
        this.renderEntryRows();

        const addBtn = entriesCard.createEl("button", { cls: "kw-entry-add", text: "＋ 添加菜单" });
        addBtn.type = "button";
        addBtn.addEventListener("click", () => {
            this.plugin.settings.sidebarEntries = this.plugin.settings.sidebarEntries ?? [];
            this.plugin.settings.sidebarEntries.push({
                type: "keyword",
                alias: "",
                value: "",
                icon: "",
            });
            this.applySettingsUpdate();
            this.renderEntryRows();
        });

        const scanCard = rootEl.createDiv({ cls: "kw-settings-card" });
        new Setting(scanCard).setName("扫描").setHeading();
        new Setting(scanCard)
            .setName("Excluded Folders")
            .setDesc("Folders to exclude from keyword scanning. One folder path per line (e.g. journals).")
            .addTextArea((text) => {
                text.inputEl.addClass("kw-settings-textarea-sm");
                text
                    .setValue((this.plugin.settings.excludedFolders || []).join("\n"))
                    .setPlaceholder("journals\narchive/old")
                    .onChange((value) => {
                        this.plugin.settings.excludedFolders = value
                            .split("\n")
                            .map(s => s.trim())
                            .filter(s => s.length > 0);
                        this.applySettingsUpdate();
                    });
            });

        const displayCard = rootEl.createDiv({ cls: "kw-settings-card" });
        new Setting(displayCard).setName("Display").setHeading();

        new Setting(displayCard)
            .setName("Default note color")
            .setDesc("Accent color used by selected notes and note dots when a note does not have its own color.")
            .addColorPicker((color) =>
                color
                    .setValue(this.plugin.settings.defaultNoteColor || DEFAULT_NOTE_COLOR)
                    .onChange((value) => {
                        this.plugin.settings.defaultNoteColor = value || DEFAULT_NOTE_COLOR;
                        this.plugin.applyDefaultNoteColor();
                        this.applySettingsUpdate();
                    })
            );

        new Setting(displayCard)
            .setName("Mobile note mode")
            .setDesc("Only affects Obsidian Mobile. Editable embeds source editors; Preview renders markdown for maximum stability.")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("editable", "Editable")
                    .addOption("preview", "Preview")
                    .setValue(this.plugin.settings.mobileNoteMode || "editable")
                    .onChange((value) => {
                        this.plugin.settings.mobileNoteMode = value as MobileNoteMode;
                        this.applySettingsUpdate();
                        if (Platform.isMobile) {
                            this.plugin.refreshKeywordNoteViews();
                        }
                    })
            );

        new Setting(displayCard)
            .setName("Random colors for unmarked notes")
            .setDesc("When enabled, notes without their own color use a stable color from the common color palette.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.useRandomNoteColors)
                    .onChange((value) => {
                        this.plugin.settings.useRandomNoteColors = value;
                        this.plugin.refreshKeywordNoteViews();
                        this.applySettingsUpdate();
                    })
            );

        new Setting(displayCard)
            .setName("New page folder")
            .setDesc("Folder path for new pages created from keyword right-click menu. Default: pages")
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.newPageFolder || "pages")
                    .setPlaceholder("pages")
                    .onChange((value) => {
                        this.plugin.settings.newPageFolder = value.trim() || "pages";
                        this.applySettingsUpdate();
                    })
            );

        new Setting(displayCard)
            .setName("Journal folders")
            .setDesc("Folders treated as journals in the Today overview. One folder path per line. Default: journals")
            .addTextArea((text) => {
                text.inputEl.addClass("kw-settings-textarea-sm");
                text
                    .setValue((this.plugin.settings.journalFolders || ["journals"]).join("\n"))
                    .setPlaceholder("journals")
                    .onChange((value) => {
                        const folders = value
                            .split("\n")
                            .map(s => s.trim())
                            .filter(s => s.length > 0);
                        this.plugin.settings.journalFolders = folders.length > 0 ? folders : ["journals"];
                        this.applySettingsUpdate();
                    });
            });


        new Setting(displayCard)
            .setName("Auto-open keyword list on startup")
            .setDesc("Automatically open the keyword list sidebar when the plugin loads. When disabled, Obsidian's default file list will be kept")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.openKeywordListOnStartup)
                    .onChange(async (value) => {
                        this.plugin.settings.openKeywordListOnStartup = value;
                        this.applySettingsUpdate();
                    })
            );



        const donateSection = rootEl.createDiv({ cls: 'plugin-donate-section' });
        new Setting(donateSection).setName('☕ Buy me a coffee').setHeading();
        donateSection.createEl('p', { text: 'If this plugin helped you, consider buying me a coffee ☕', cls: 'plugin-donate-desc' });
        const imgWrap = donateSection.createDiv({ cls: 'plugin-donate-qr' });
        const donateImg = imgWrap.createEl('img', { attr: { src: "https://raw.githubusercontent.com/fengshuzi/images/main/wechat-donate.jpg", alt: 'WeChat Donate' }, cls: 'plugin-donate-img' });
        donateImg.addEventListener('click', () => {
            const overlay = activeDocument.body.createDiv({ cls: 'plugin-donate-lightbox' });
            overlay.createEl('img', { attr: { src: "https://raw.githubusercontent.com/fengshuzi/images/main/wechat-donate.jpg", alt: 'WeChat Donate' }, cls: 'plugin-donate-lightbox-img' });
            overlay.addEventListener('click', () => overlay.remove());
        });
        imgWrap.createEl('p', { text: 'Scan to donate', cls: 'plugin-donate-label' });
    }


    private renderEntryRows(): void {
        this.entriesEl.empty();
        const entries = this.plugin.settings.sidebarEntries ?? [];
        entries.forEach((entry, index) => {
            this.renderEntryRow(entry, index);
        });
    }

    private renderEntryRow(entry: SidebarEntry, index: number): void {
        const row = this.entriesEl.createDiv({ cls: "kw-entry-row" });
        row.dataset.index = String(index);

        const handle = row.createSpan({ cls: "kw-entry-drag", text: "☰" });
        handle.setAttribute("title", "拖动排序");
        handle.draggable = true;

        const nameInput = row.createEl("input", { cls: "kw-entry-name", type: "text" });
        nameInput.placeholder = "菜单名称";
        nameInput.value = entry.alias;

        const typeSelect = row.createEl("select", { cls: "kw-entry-type" });
        (Object.keys(ENTRY_TYPE_META) as SidebarEntryType[]).forEach((typeKey) => {
            const opt = typeSelect.createEl("option", { text: ENTRY_TYPE_META[typeKey].label });
            opt.value = typeKey;
            if (typeKey === entry.type) opt.selected = true;
        });

        const valueWrap = row.createDiv({ cls: "kw-entry-value-wrap" });
        this.renderValueControl(valueWrap, entry);

        const delBtn = row.createEl("button", { cls: "kw-entry-del", text: "×" });
        delBtn.type = "button";
        delBtn.setAttribute("title", "删除");

        const entries = () => this.plugin.settings.sidebarEntries ?? [];

        nameInput.addEventListener("change", () => {
            entry.alias = nameInput.value.trim();
            this.applySettingsUpdate();
            this.plugin.refreshKeywordList();
        });

        typeSelect.addEventListener("change", () => {
            entry.type = typeSelect.value as SidebarEntryType;
            entry.value = entry.type === "todo" ? "" : entry.type === "recent" ? "yesterday" : entry.value;
            this.renderValueControl(valueWrap, entry);
            this.applySettingsUpdate();
            this.plugin.refreshKeywordList();
        });

        delBtn.addEventListener("click", () => {
            entries().splice(index, 1);
            this.applySettingsUpdate();
            this.plugin.refreshKeywordList();
            this.renderEntryRows();
        });

        // HTML5 drag & drop ordering (initiated from the ☰ handle)
        handle.addEventListener("dragstart", (e) => {
            row.addClass("is-dragging");
            e.dataTransfer?.setData("text/plain", String(index));
            if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        });
        handle.addEventListener("dragend", () => {
            row.removeClass("is-dragging");
            this.entriesEl.querySelectorAll(".is-drop-target").forEach(el => el.removeClass("is-drop-target"));
        });
        row.addEventListener("dragover", (e) => {
            e.preventDefault();
            row.addClass("is-drop-target");
            if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        });
        row.addEventListener("dragleave", () => {
            row.removeClass("is-drop-target");
        });
        row.addEventListener("drop", (e) => {
            e.preventDefault();
            const from = Number(e.dataTransfer?.getData("text/plain") ?? "-1");
            const to = index;
            const list = entries();
            if (from >= 0 && from !== to && from < list.length) {
                const [moved] = list.splice(from, 1);
                list.splice(to, 0, moved);
                this.applySettingsUpdate();
                this.plugin.refreshKeywordList();
            }
            this.renderEntryRows();
        });
    }

    private renderValueControl(wrap: HTMLElement, entry: SidebarEntry): void {
        wrap.empty();
        if (entry.type === "todo") return;

        if (entry.type === "recent") {
            const presetSelect = wrap.createEl("select", { cls: "kw-entry-recent-preset" });
            const presetValues = Object.keys(RECENT_PRESETS);
            const isPreset = presetValues.includes(entry.value);
            presetValues.forEach((val) => {
                const opt = presetSelect.createEl("option", { text: RECENT_PRESETS[val] });
                opt.value = val;
                if (val === entry.value) opt.selected = true;
            });
            const customOpt = presetSelect.createEl("option", { text: "自定义天数" });
            customOpt.value = "__custom";
            if (!isPreset) customOpt.selected = true;

            const daysInput = wrap.createEl("input", { cls: "kw-entry-recent-days", type: "number" });
            daysInput.min = "1";
            daysInput.placeholder = "天数";
            if (!isPreset) daysInput.value = entry.value;
            daysInput.toggleClass("kw-hidden", isPreset);

            presetSelect.addEventListener("change", () => {
                if (presetSelect.value === "__custom") {
                    daysInput.removeClass("kw-hidden");
                    entry.value = daysInput.value.trim() || "1";
                } else {
                    daysInput.addClass("kw-hidden");
                    entry.value = presetSelect.value;
                }
                this.applySettingsUpdate();
                this.plugin.refreshKeywordList();
            });
            daysInput.addEventListener("change", () => {
                const days = Math.max(1, Number.parseInt(daysInput.value, 10) || 1);
                daysInput.value = String(days);
                entry.value = String(days);
                this.applySettingsUpdate();
                this.plugin.refreshKeywordList();
            });
            return;
        }

        const valueInput = wrap.createEl("input", { cls: "kw-entry-value", type: "text" });
        valueInput.placeholder = entry.type === "keyword"
            ? "标签，如 p1 或 p1+p2"
            : entry.type === "doc"
                ? "笔记路径，如 pages/inbox.md"
                : "路径，如 projects/work";
        valueInput.value = entry.value;
        valueInput.addEventListener("change", () => {
            entry.value = valueInput.value.trim().replace(/^#/, "");
            this.applySettingsUpdate();
            this.plugin.refreshKeywordList();
        });
    }

    applySettingsUpdate(): void {
        void this.plugin.saveSettings();
    }
}
