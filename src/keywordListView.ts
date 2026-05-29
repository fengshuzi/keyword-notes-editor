import { ItemView, WorkspaceLeaf } from "obsidian";
import type KeywordNotesPlugin from "./keywordNotesPlugin";
import type { KeywordConfig, FolderConfig } from "./keywordNoteSettings";

export const KEYWORD_LIST_VIEW_TYPE = "keyword-list-view";

/** Tag tree node */
interface TagTreeNode {
    name: string;                       // Display name for current level (last segment)
    fullPath: string;                   // Full tag path (e.g., "test/work/meeting")
    children: Map<string, TagTreeNode>; // Child nodes
}

/**
 * Build a tree structure from a flat tag list
 * For example ['test/work', 'test/work/meeting', 'test/ideas'] →
 * { work: { fullPath:'test/work', children: { meeting: {...} } }, ideas: {...} }
 */
function buildTagTree(subTags: string[], rootPrefix: string): Map<string, TagTreeNode> {
    const root = new Map<string, TagTreeNode>();

    for (const tag of [...subTags].sort()) {
        // Remove root prefix, get relative path (e.g., "test/work/meeting" → "work/meeting")
        const relative = tag.slice(rootPrefix.length + 1);
        const parts = relative.split('/').filter(Boolean);

        let currentMap = root;
        let currentPath = rootPrefix;

        for (const part of parts) {
            currentPath = `${currentPath}/${part}`;
            if (!currentMap.has(part)) {
                currentMap.set(part, {
                    name: part,
                    fullPath: currentPath,
                    children: new Map(),
                });
            }
            currentMap = currentMap.get(part)!.children;
        }
    }

    return root;
}

export class KeywordListView extends ItemView {
    plugin: KeywordNotesPlugin;
    private listEl: HTMLElement;

    /** Collapse state: key is node fullPath, value is whether expanded */
    private expandedStates: Map<string, boolean> = new Map();

    constructor(leaf: WorkspaceLeaf, plugin: KeywordNotesPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { return KEYWORD_LIST_VIEW_TYPE; }
    getDisplayText(): string { return "Keyword List"; }
    getIcon(): string { return "list"; }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("keyword-list-container");
        this.listEl = container.createDiv({ cls: "keyword-list-content" });
        this.renderList();
    }

    public refresh(): void {
        if (this.listEl) this.renderList();
    }

    // ── Top-level list rendering ────────────────────────────────────────────

    private renderList(): void {
        this.listEl.empty();

        const { keywords, folders } = this.plugin.settings;

        keywords.forEach((item) => {
            const subTags = this.plugin.getSubTagsForKeyword(item.keyword);
            if (subTags.length > 0) {
                this.renderKeywordWithTree(item, subTags);
            } else {
                this.renderItem(item, "keyword");
            }
        });

        folders.forEach((item) => {
            this.renderItem(item, "folder");
        });

        if (keywords.length === 0 && folders.length === 0) {
            const emptyEl = this.listEl.createDiv({ cls: "keyword-list-empty" });
            emptyEl.createSpan({ text: "No configuration" });
            emptyEl.createEl("br");
            emptyEl.createSpan({
                text: "Add keywords or folders in plugin settings",
                cls: "keyword-list-empty-hint"
            });
        }
    }

    // ── Top-level keyword node with sub-tag tree ──────────────────────────────

    private renderKeywordWithTree(item: KeywordConfig, subTags: string[]): void {
        const tree = buildTagTree(subTags, item.keyword);
        const stateKey = `kw:${item.keyword}`;
        const isExpanded = this.expandedStates.get(stateKey) ?? false;

        const wrapperEl = this.listEl.createDiv({ cls: "keyword-list-tree-wrapper" });

        // Parent node row
        const parentEl = wrapperEl.createDiv({ cls: "keyword-list-item keyword-list-item--parent" });
        const arrowEl = parentEl.createSpan({
            cls: `keyword-list-item-arrow ${isExpanded ? "is-expanded" : ""}`
        });
        parentEl.createSpan({ text: item.icon, cls: "keyword-list-item-icon" });
        const nameEl = parentEl.createSpan({ cls: "keyword-list-item-name" });
        nameEl.setText(item.alias);

        // First-level subtree container
        const subListEl = wrapperEl.createDiv({
            cls: `keyword-list-subtag-list ${isExpanded ? "is-expanded" : ""}`
        });

        const toggle = () => {
            const now = !this.expandedStates.get(stateKey);
            this.expandedStates.set(stateKey, now);
            arrowEl.toggleClass("is-expanded", now);
            subListEl.toggleClass("is-expanded", now);
            if (now && subListEl.childElementCount === 0) {
                this.renderTreeNodes(tree, subListEl, item.keyword);
            }
        };

        arrowEl.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
        nameEl.addEventListener("click", (e) => { e.stopPropagation(); this.plugin.openKeywordView(item); });
        parentEl.querySelector(".keyword-list-item-icon")?.addEventListener("click", (e) => {
            e.stopPropagation();
            this.plugin.openKeywordView(item);
        });

        if (isExpanded) {
            this.renderTreeNodes(tree, subListEl, item.keyword);
        }
    }

    // ── Recursive tree node rendering ──────────────────────────────────────────

    /**
     * Recursively render a group of tree nodes into a container
     * @param nodes  Node Map for current level
     * @param containerEl  Target container for rendering
     * @param parentPath  Parent path (used to distinguish leaf node tooltip)
     */
    private renderTreeNodes(
        nodes: Map<string, TagTreeNode>,
        containerEl: HTMLElement,
        parentPath: string
    ): void {
        for (const [, node] of nodes) {
            const hasChildren = node.children.size > 0;

            if (hasChildren) {
                this.renderBranchNode(node, containerEl);
            } else {
                this.renderLeafNode(node, containerEl);
            }
        }
    }

    /** Render branch node with children (collapsible) */
    private renderBranchNode(node: TagTreeNode, containerEl: HTMLElement): void {
        const stateKey = node.fullPath;
        const isExpanded = this.expandedStates.get(stateKey) ?? false;

        const wrapperEl = containerEl.createDiv({ cls: "keyword-list-subtag-wrapper" });

        // Node row (with arrow)
        const itemEl = wrapperEl.createDiv({ cls: "keyword-list-subtag-item keyword-list-subtag-item--branch" });
        const arrowEl = itemEl.createSpan({
            cls: `keyword-list-subtag-arrow ${isExpanded ? "is-expanded" : ""}`
        });
        const nameEl = itemEl.createSpan({ cls: "keyword-list-subtag-name" });
        nameEl.setText(node.name);
        nameEl.setAttribute("title", `#${node.fullPath}`);

        // Subtree container
        const childrenEl = wrapperEl.createDiv({
            cls: `keyword-list-subtag-children ${isExpanded ? "is-expanded" : ""}`
        });

        const toggle = () => {
            const now = !this.expandedStates.get(stateKey);
            this.expandedStates.set(stateKey, now);
            arrowEl.toggleClass("is-expanded", now);
            childrenEl.toggleClass("is-expanded", now);
            if (now && childrenEl.childElementCount === 0) {
                this.renderTreeNodes(node.children, childrenEl, node.fullPath);
            }
        };

        arrowEl.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
        // Click name: open this node (including all sub-tags underneath)
        nameEl.addEventListener("click", (e) => {
            e.stopPropagation();
            this.plugin.openSubTagView(node.fullPath, true);
        });

        if (isExpanded) {
            this.renderTreeNodes(node.children, childrenEl, node.fullPath);
        }
    }

    /** Render leaf node (no children, direct click to open) */
    private renderLeafNode(node: TagTreeNode, containerEl: HTMLElement): void {
        const itemEl = containerEl.createDiv({ cls: "keyword-list-subtag-item" });
        const nameEl = itemEl.createSpan({ cls: "keyword-list-subtag-name" });
        nameEl.setText(node.name);
        nameEl.setAttribute("title", `#${node.fullPath}`);

        itemEl.addEventListener("click", () => {
            this.plugin.openSubTagView(node.fullPath, false);
        });
    }

    // ── Regular item (keyword without sub-tags / folder) ───────────────────────

    private renderItem(item: KeywordConfig | FolderConfig, type: "keyword" | "folder"): void {
        const itemEl = this.listEl.createDiv({ cls: "keyword-list-item" });
        itemEl.createSpan({ text: item.icon, cls: "keyword-list-item-icon" });
        const nameEl = itemEl.createSpan({ cls: "keyword-list-item-name" });
        nameEl.setText(item.alias);

        if (type === "folder") {
            const folder = item as FolderConfig;
            if (folder.path !== folder.alias) itemEl.setAttribute("title", folder.path);
        }

        itemEl.addEventListener("click", () => {
            if (type === "keyword") this.plugin.openKeywordView(item as KeywordConfig);
            else this.plugin.openFolderView(item as FolderConfig);
        });
    }

    async onClose(): Promise<void> {}
}
