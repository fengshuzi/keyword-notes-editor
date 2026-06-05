import KeywordNotesPlugin from "./keywordNotesPlugin";
import { App, Platform, PluginSettingTab, Setting } from "obsidian";

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

export type MobileNoteMode = "editable" | "preview";

export interface KeywordNotesSettings {
    hideFrontmatter: boolean;
    hideBacklinks: boolean;
    createAndOpenOnStartup: boolean;
    useArrowUpOrDownToNavigate: boolean;
    openKeywordListOnStartup: boolean;  // Do not auto-open keyword list by default
    mobileNoteMode: MobileNoteMode;

    // Keyword configuration
    keywords: KeywordConfig[];
    
    // Folder configuration
    folders: FolderConfig[];

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
}

// Fruit icon list (shared by keywords and folders)
const FRUIT_ICONS = ['🍎', '🍏', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🌽', '🥕', '🥦', '🌰'];

export const DEFAULT_NOTE_COLOR = "#ffb000";

export const DEFAULT_SETTINGS: KeywordNotesSettings = {
    hideFrontmatter: false,
    hideBacklinks: true,
    createAndOpenOnStartup: false,
    useArrowUpOrDownToNavigate: false,
    openKeywordListOnStartup: false,  // Do not auto-open keyword list by default
    mobileNoteMode: "editable",
    keywords: [],
    folders: [],
    preset: [],
    excludedFolders: [],
    newPageFolder: "pages",
    journalFolders: ["journals"],
    pinnedNotes: {},
    noteColors: {},
    defaultNoteColor: DEFAULT_NOTE_COLOR,
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

// Convert keyword configuration to string (supports aggregation: p1+p2+p3+p4|Quadrant)
export function keywordsToString(keywords: KeywordConfig[]): string {
    return keywords.map((k, index) => {
        const autoIcon = FRUIT_ICONS[index % FRUIT_ICONS.length];
        const hasCustomIcon = k.icon && k.icon !== autoIcon;
        const keywordPart = (k.keywords && k.keywords.length > 1)
            ? k.keywords.join('+')
            : k.keyword;

        if (hasCustomIcon && k.alias !== keywordPart) {
            return `${keywordPart}|${k.alias}|${k.icon}`;
        } else if (hasCustomIcon) {
            return `${keywordPart}||${k.icon}`;
        } else if (k.alias !== keywordPart) {
            return `${keywordPart}|${k.alias}`;
        }
        return keywordPart;
    }).join(',');
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

// Convert folder configuration to string
export function foldersToString(folders: FolderConfig[]): string {
    return folders.map(f => {
        const defaultAlias = f.path.split('/').pop() || f.path;
        if (f.icon && f.alias !== defaultAlias) {
            return `${f.path}|${f.alias}|${f.icon}`;
        } else if (f.alias !== defaultAlias) {
            return `${f.path}|${f.alias}`;
        }
        return f.path;
    }).join(',');
}

export class KeywordNotesSettingTab extends PluginSettingTab {
    plugin: KeywordNotesPlugin;

    constructor(app: App, plugin: KeywordNotesPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        new Setting(containerEl).setName("General").setHeading();

        // Keyword configuration
        new Setting(containerEl).setName("Keyword Configuration").setHeading();

        new Setting(containerEl)
            .setName("Keyword List")
            .setDesc("Configure keywords to display. Format: tag|alias|icon, multiple separated by commas. Aggregation mode: p1+p2+p3+p4|Quadrant matches any one tag.")
            .addTextArea((text) => {
                text.inputEl.addClass("kw-settings-textarea");
                text
                    .setValue(keywordsToString(this.plugin.settings.keywords))
                    .setPlaceholder("test/work|Work Project,project|Project")
                    .onChange((value) => {
                        this.plugin.settings.keywords = parseKeywordsString(value);
                        this.applySettingsUpdate();
                        // Reassign icons to avoid duplicates
                        // Icons are auto-assigned on save
                        // Refresh keyword list
                        this.plugin.refreshKeywordList();
                    });
            });

        // Preview current keyword configuration
        if (this.plugin.settings.keywords.length > 0) {
            const previewEl = containerEl.createDiv({ cls: "keyword-preview" });
            previewEl.createEl("p", { text: "Current keywords preview:" });
            const listEl = previewEl.createEl("div", { cls: "keyword-list" });
            this.plugin.settings.keywords.forEach(k => {
                listEl.createEl("span", { 
                    text: `${k.icon} ${k.alias}`,
                    cls: "keyword-item"
                });
            });
        }

        // Folder configuration
        new Setting(containerEl).setName("Folder Configuration").setHeading();

        new Setting(containerEl)
            .setName("Folder List")
            .setDesc("Configure folders to display. Format: path|alias|icon, multiple separated by commas. Supports multi-level paths, e.g.: projects/work|Work Projects,archive|Archive")
            .addTextArea((text) => {
                text.inputEl.addClass("kw-settings-textarea");
                text
                    .setValue(foldersToString(this.plugin.settings.folders))
                    .setPlaceholder("projects/work|Work Projects,archive|Archive")
                    .onChange((value) => {
                        // Folder icons start after keywords count to avoid duplication
                        const keywordCount = this.plugin.settings.keywords.length;
                        this.plugin.settings.folders = parseFoldersString(value, keywordCount);
                        this.applySettingsUpdate();
                        // Refresh keyword list
                        this.plugin.refreshKeywordList();
                    });
            });

        // Preview current folder configuration
        if (this.plugin.settings.folders.length > 0) {
            const previewEl = containerEl.createDiv({ cls: "folder-preview" });
            previewEl.createEl("p", { text: "Current folders preview:" });
            const listEl = previewEl.createEl("div", { cls: "folder-list" });
            this.plugin.settings.folders.forEach(f => {
                listEl.createEl("span", { 
                    text: `${f.icon} ${f.alias}`,
                    cls: "folder-item",
                    attr: { title: f.path }
                });
            });
        }

        new Setting(containerEl)
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

        new Setting(containerEl).setName("Display").setHeading();

        new Setting(containerEl)
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

        new Setting(containerEl)
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


        new Setting(containerEl)
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

        new Setting(containerEl)
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


        new Setting(containerEl)
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



        new Setting(containerEl)
            .setName("Hide Frontmatter")
            .setDesc("Hide frontmatter in the note view")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.hideFrontmatter)
                    .onChange(async (value) => {
                        this.plugin.settings.hideFrontmatter = value;

                        document.body.classList.toggle(
                            "keyword-notes-hide-frontmatter",
                            value
                        );
                        this.applySettingsUpdate();
                    })
            );

        new Setting(containerEl)
            .setName("Hide Backlinks")
            .setDesc("Hide backlinks in the note view")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.hideBacklinks)
                    .onChange(async (value) => {
                        this.plugin.settings.hideBacklinks = value;

                        document.body.classList.toggle(
                            "keyword-notes-hide-backlinks",
                            value
                        );
                        this.applySettingsUpdate();
                    })
            );

        new Setting(containerEl)
            .setName("Use Arrow Up/Down to navigate")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.useArrowUpOrDownToNavigate)
                    .onChange(async (value) => {
                        this.plugin.settings.useArrowUpOrDownToNavigate = value;
                        this.applySettingsUpdate();
                    })
            );

        const donateSection = containerEl.createDiv({ cls: 'plugin-donate-section' });
        new Setting(donateSection).setName('☕ Buy me a coffee').setHeading();
        donateSection.createEl('p', { text: 'If this plugin helped you, consider buying me a coffee ☕', cls: 'plugin-donate-desc' });
        const imgWrap = donateSection.createDiv({ cls: 'plugin-donate-qr' });
        imgWrap.createEl('img', { attr: { src: "https://raw.githubusercontent.com/fengshuzi/images/main/wechat-donate.jpg", alt: 'WeChat Donate', width: '160' } });
        imgWrap.createEl('p', { text: 'Scan to donate', cls: 'plugin-donate-label' });
    }

    applySettingsUpdate(): void {
        this.plugin.saveSettings();
    }
}
