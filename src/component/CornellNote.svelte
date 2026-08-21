<script lang="ts">
    import type KeywordNotesPlugin from "../keywordNotesPlugin";
    import { Component, MarkdownRenderer, TAbstractFile, TFile, WorkspaceLeaf, setIcon } from "obsidian";
    import KeywordNote from "./KeywordNote.svelte";
    import { CornellDocument, parseCornellDocument } from "../utils/cornellParser";
    import { onDestroy, onMount, tick } from "svelte";

    export let file: TAbstractFile;
    export let plugin: KeywordNotesPlugin;
    export let leaf: WorkspaceLeaf;

    // 康奈尔分区显隐 + 线索列宽度
    export let showCue: boolean = true;
    export let showBody: boolean = true;
    export let showSummary: boolean = true;
    export let cueWidth: number = 176;

    // 编辑态就是现成的关键词卡片，这些原样透传
    export let collapseAll: boolean | null = null;
    export let onIndividualToggle: (() => void) | null = null;
    export let onDeleteNote: ((file: TFile) => Promise<void>) | null = null;
    export let isPinned: boolean = false;
    export let onTogglePinned: ((file: TFile, pinned: boolean) => Promise<void>) | null = null;
    export let noteColor: string | null = null;
    export let onSetNoteColor: ((file: TFile, color: string | null) => void) | null = null;
    export let selectedPath: string | null = null;
    export let onSelectNote: ((file: TFile) => void) | null = null;

    /** 窄于此宽度时线索卡改为堆在正文卡上方 */
    const NARROW_BREAKPOINT = 560;

    let rootEl: HTMLElement | null = null;
    let readEl: HTMLElement | null = null;
    let bodyEl: HTMLElement | null = null;
    /** 当前悬停/点击的线索序号，用于两栏联动 */
    let activeCue: number | null = null;

    let doc: CornellDocument | null = null;
    let title = "";
    let loadError: string | null = null;
    let loadedPath = "";
    let isNarrow = false;
    let isDestroying = false;

    /** false = 康奈尔排版，true = 现成的关键词卡片编辑态 */
    let isEditing = false;
    /** 切换前的排版高度，避免编辑器挂载时页面跳动 */
    let editMinHeight = 0;

    const renderHost = new Component();

    onMount(() => {
        renderHost.load();
        renderHost.registerEvent(
            plugin.app.metadataCache.on("changed", (changed) => {
                if (isEditing || !(file instanceof TFile)) return;
                if (changed.path === file.path) void reload();
            })
        );

        if (rootEl && typeof ResizeObserver !== "undefined") {
            const observer = new ResizeObserver((entries) => {
                const width = entries[0]?.contentRect.width ?? 0;
                if (width > 0) isNarrow = width < NARROW_BREAKPOINT;
            });
            observer.observe(rootEl);
            renderHost.register(() => observer.disconnect());
        }
    });

    onDestroy(() => {
        isDestroying = true;
        renderHost.unload();
    });

    // 列表按 path 复用组件实例，文件换了要重新解析
    $: if (file instanceof TFile && file.path !== loadedPath) {
        loadedPath = file.path;
        title = file.basename;
        isEditing = false;
        void reload();
    }

    $: layoutStyle = `--kw-cornell-cue-width: ${Math.max(80, cueWidth)}px;${
        noteColor ? ` --kw-cornell-accent: ${noteColor};` : ""
    }`;
    $: isSelected = file instanceof TFile && selectedPath === file.path;

    // 三张卡，各自是一个整体：所有线索一篇、所有正文一篇、总结一篇
    $: cues = doc ? doc.rows.map((row) => row.cue).filter((cue) => cue.length > 0) : [];
    // 正文保留 `##` 标题，否则各段内容糊在一起，跟左边的线索对不上
    $: bodyMarkdown = doc
        ? [
              doc.topic?.body ?? "",
              ...doc.rows.map((row) => (row.body ? `## ${row.cue}\n\n${row.body}` : `## ${row.cue}`)),
          ]
              .map((part) => part.trim())
              .filter((part) => part.length > 0)
              .join("\n\n")
        : "";

    async function reload() {
        if (!(file instanceof TFile)) return;
        title = file.basename;
        try {
            doc = await parseCornellDocument(plugin.app, file);
            loadError = null;
        } catch (error) {
            console.error("Keyword Notes Editor: failed to parse Cornell note", error);
            loadError = "解析失败，请检查笔记内容";
            doc = null;
        }
    }

    function selectNote() {
        if (file instanceof TFile && onSelectNote) onSelectNote(file);
    }

    /** 正文卡里第 index 段的标题元素；顺序与线索一致 */
    function sectionHeading(index: number): HTMLElement | null {
        const headings = bodyEl?.querySelectorAll<HTMLElement>("h2");
        return headings?.[index] ?? null;
    }

    /** 悬停线索时点亮对应的正文段落，让两边的对应关系可见 */
    function highlightSection(index: number | null) {
        bodyEl?.querySelectorAll(".kw-cornell-linked").forEach((el) => el.removeClass("kw-cornell-linked"));
        activeCue = index;
        if (index === null) return;
        sectionHeading(index)?.addClass("kw-cornell-linked");
    }

    /** 点击线索把对应段落滚进视野（长笔记时有用） */
    function focusSection(index: number) {
        selectNote();
        highlightSection(index);
        sectionHeading(index)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    /** 切到现成的关键词卡片编辑态 */
    function enterEdit() {
        if (!(file instanceof TFile) || isEditing) return;
        selectNote();
        editMinHeight = readEl?.offsetHeight ?? 0;
        isEditing = true;
    }

    async function exitEdit() {
        if (!isEditing) return;
        isEditing = false;
        editMinHeight = 0;
        if (!isDestroying) {
            await tick();
            await reload();
        }
    }

    function openInMainView() {
        if (!(file instanceof TFile)) return;
        void plugin.app.workspace.openLinkText(file.path, file.path, false);
    }

    /** 单击只处理链接跳转与选中 */
    function handleClick(event: MouseEvent) {
        const target = event.target;
        if (target instanceof HTMLElement) {
            const link = target.closest("a");
            if (link) {
                event.stopPropagation();
                const href = link.getAttr("data-href") ?? link.getAttr("href");
                if (link.hasClass("internal-link") && href) {
                    event.preventDefault();
                    void plugin.app.workspace.openLinkText(href, file.path, false);
                }
                return;
            }
        }
        selectNote();
    }

    /** 双击进入编辑 */
    function handleDblClick(event: MouseEvent) {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("a")) return;
        event.preventDefault();
        enterEdit();
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape" && isEditing) {
            event.preventDefault();
            event.stopPropagation();
            void exitEdit();
        }
    }

    /** 焦点离开整块区域就回到康奈尔排版 */
    function handleFocusOut(event: FocusEvent) {
        if (!isEditing) return;
        const next = event.relatedTarget;
        if (next instanceof Node && rootEl?.contains(next)) return;

        window.setTimeout(() => {
            if (!isEditing || isDestroying || !rootEl) return;
            // 编辑器还没挂载：这次 focusout 是我们自己切换 DOM 造成的（比如点铅笔时
            // 按钮先拿到焦点、随后连同展示态一起被销毁），不能当成用户离开。
            if (!rootEl.querySelector(".cm-content")) return;
            const ownerDoc = rootEl.ownerDocument;
            if (ownerDoc.activeElement && rootEl.contains(ownerDoc.activeElement)) return;
            // 菜单、弹窗、补全面板会抢焦点，但用户并没有离开这张卡
            if (ownerDoc.body.querySelector(".modal-container, .menu, .suggestion-container, .prompt")) return;
            void exitEdit();
        }, 150);
    }

    function icon(node: HTMLElement, name: string) {
        setIcon(node, name);
        return {
            update(next: string) {
                node.empty();
                setIcon(node, next);
            },
        };
    }

    /** 只读 Markdown 渲染 */
    function markdown(node: HTMLElement, body: string) {
        let current = body;
        render(node, body);
        return {
            update(next: string) {
                if (next === current) return;
                current = next;
                render(node, next);
            },
            destroy() {
                node.empty();
            },
        };
    }

    function render(node: HTMLElement, body: string) {
        node.empty();
        const text = body.trim();
        if (!text) {
            node.createDiv({ cls: "kw-cornell-blank", text: "（空）" });
            return;
        }
        void MarkdownRenderer.render(plugin.app, text, node, file.path, renderHost);
    }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    class="kw-cornell-root"
    class:is-editing={isEditing}
    class:is-narrow={isNarrow}
    style={layoutStyle}
    bind:this={rootEl}
    on:keydown={handleKeydown}
    on:focusout={handleFocusOut}
>
    {#if isEditing}
        <!-- 编辑态：现成的关键词卡片，外层不加任何修饰 -->
        <div class="kw-cornell-edit" style={editMinHeight ? `min-height: ${editMinHeight}px` : ""}>
            <button
                type="button"
                class="kw-cornell-back"
                aria-label="返回康奈尔排版"
                title="返回康奈尔排版 (Esc)"
                on:click|stopPropagation={() => void exitEdit()}
                use:icon={"columns-3"}
            ></button>
            <KeywordNote
                {file}
                {plugin}
                {leaf}
                shouldRender={true}
                {collapseAll}
                {onIndividualToggle}
                {onDeleteNote}
                {isPinned}
                {onTogglePinned}
                {noteColor}
                {onSetNoteColor}
                {selectedPath}
                {onSelectNote}
            />
        </div>
    {:else}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div
            class="kw-cornell-page"
            class:is-selected={isSelected}
            bind:this={readEl}
            on:click={handleClick}
            on:dblclick={handleDblClick}
            title="双击进入编辑"
        >
            <div class="kw-cornell-topbar">
                <span class="kw-cornell-dot" aria-hidden="true"></span>
                <span
                    class="kw-cornell-title"
                    role="link"
                    tabindex="0"
                    on:click|stopPropagation={openInMainView}
                    on:keydown={(e) => e.key === "Enter" && openInMainView()}>{title}</span
                >
                <span class="kw-cornell-spacer"></span>
                <button
                    type="button"
                    class="kw-cornell-icon"
                    aria-label="编辑"
                    title="编辑"
                    on:click|stopPropagation={enterEdit}
                    use:icon={"pencil"}
                ></button>
            </div>

            {#if loadError}
                <div class="kw-cornell-note-card is-hint is-error">{loadError}</div>
            {:else if !doc}
                <div class="kw-cornell-note-card is-hint">读取中…</div>
            {:else if doc.isEmpty}
                <div class="kw-cornell-note-card is-hint">空笔记，双击开始记录</div>
            {:else}
                {#if !doc.hasCues}
                    <div class="kw-cornell-note-card is-hint">
                        用 <code>## 线索</code> 分段就会排成康奈尔布局，最后一个 <code>##</code> 分区自动作为总结卡
                    </div>
                {/if}

                <div class="kw-cornell-columns" class:no-cue={!showCue || cues.length === 0}>
                    {#if showCue && cues.length > 0}
                        <!-- 线索卡：所有线索聚合成一整篇 -->
                        <aside class="kw-cornell-cue-card">
                            <div class="kw-cornell-card-label">
                                <span class="kw-cornell-card-icon" use:icon={"list"}></span>
                                <span>线索</span>
                            </div>
                            <ol class="kw-cornell-cue-list">
                                {#each cues as cue, index (index)}
                                    <li>
                                        <button
                                            type="button"
                                            class="kw-cornell-cue-line"
                                            class:is-active={activeCue === index}
                                            on:click|stopPropagation={() => focusSection(index)}
                                            on:mouseenter={() => highlightSection(index)}
                                            on:mouseleave={() => highlightSection(null)}
                                        >
                                            <span class="kw-cornell-cue-index">{index + 1}</span>
                                            <span class="kw-cornell-cue-text">{cue}</span>
                                        </button>
                                    </li>
                                {/each}
                            </ol>
                        </aside>
                    {/if}
                    {#if showBody}
                        <!-- 正文卡：所有正文聚合成一整篇，保留各段 ## 标题 -->
                        <div class="kw-cornell-note-card markdown-rendered" bind:this={bodyEl}>
                            <div use:markdown={bodyMarkdown}></div>
                        </div>
                    {/if}
                </div>

                {#if showSummary && doc.summary}
                    {@const summary = doc.summary}
                    <!-- 总结卡：横贯全宽 -->
                    <div class="kw-cornell-summary-card markdown-rendered">
                        <div class="kw-cornell-summary-label">
                            <span class="kw-cornell-summary-icon" use:icon={"text-quote"}></span>
                            <span>{summary.cue}</span>
                        </div>
                        <div use:markdown={summary.body}></div>
                    </div>
                {/if}
            {/if}
        </div>
    {/if}
</div>

<style>
    .kw-cornell-root {
        --kw-cornell-accent: var(--keyword-notes-default-color, #ffb000);
        --kw-cornell-cue-width: 176px;
        --kw-cornell-gap: 10px;
    }

    /* 编辑态：外层不留任何修饰，里面就是原样的关键词卡片 */
    .kw-cornell-edit {
        position: relative;
    }

    .kw-cornell-back {
        position: absolute;
        top: var(--size-2-3);
        right: var(--size-2-3);
        z-index: 2;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: none;
        border-radius: var(--radius-s);
        background: var(--background-secondary);
        box-shadow: none;
        color: var(--text-muted);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.16s ease, color 0.16s ease;
    }

    .kw-cornell-edit:hover .kw-cornell-back,
    .kw-cornell-back:focus-visible {
        opacity: 1;
    }

    .kw-cornell-back:hover {
        color: var(--text-normal);
    }

    /* ── 康奈尔页面：一张纸，里面是三种卡片 ── */
    .kw-cornell-page {
        display: flex;
        flex-direction: column;
        gap: var(--kw-cornell-gap);
        padding: var(--size-2-3) var(--size-2-3) var(--size-4-2);
        border-radius: 12px;
        border: 1px solid transparent;
        cursor: default;
        transition: border-color 0.16s ease;
    }

    .kw-cornell-page.is-selected {
        border-color: color-mix(in srgb, var(--kw-cornell-accent) 45%, var(--background-modifier-border));
    }

    .kw-cornell-topbar {
        display: flex;
        align-items: center;
        gap: var(--size-2-3);
        padding: var(--size-2-2) var(--size-2-2) 0 var(--size-2-3);
    }

    .kw-cornell-dot {
        flex: none;
        width: 13px;
        height: 13px;
        border: 2px solid var(--kw-cornell-accent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--kw-cornell-accent) 16%, transparent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--kw-cornell-accent) 12%, transparent);
    }

    .kw-cornell-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--inline-title-size, 1.5em);
        font-weight: var(--inline-title-weight, 700);
        line-height: 1.3;
        color: var(--text-normal);
        cursor: pointer;
    }

    .kw-cornell-title:hover {
        color: var(--color-accent);
        text-decoration: underline;
    }

    .kw-cornell-spacer {
        flex: 1;
    }

    .kw-cornell-icon {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: none;
        border-radius: var(--radius-s);
        background: transparent;
        box-shadow: none;
        color: var(--text-muted);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.16s ease, color 0.16s ease, background-color 0.16s ease;
    }

    .kw-cornell-page:hover .kw-cornell-icon,
    .kw-cornell-icon:focus-visible {
        opacity: 1;
    }

    .kw-cornell-icon:hover {
        color: var(--text-normal);
        background: var(--background-modifier-hover);
    }

    /*
     * 只有两列：左边一张线索卡，右边一张正文卡，各自是一个整体。
     * 不按行切格子，所以不会有表格感。
     */
    .kw-cornell-columns {
        display: grid;
        grid-template-columns: var(--kw-cornell-cue-width) minmax(0, 1fr);
        gap: var(--kw-cornell-gap);
        /* 线索卡与正文卡等高，谁高谁撑起这一页 */
        align-items: stretch;
    }

    .kw-cornell-columns.no-cue,
    .kw-cornell-root.is-narrow .kw-cornell-columns {
        grid-template-columns: minmax(0, 1fr);
    }

    /* 线索卡：所有线索一篇 */
    .kw-cornell-cue-card {
        display: flex;
        flex-direction: column;
        gap: var(--size-2-3);
        padding: var(--size-4-2) var(--size-2-3) var(--size-4-2) var(--size-2-3);
        border-radius: 10px;
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-left: 3px solid var(--kw-cornell-accent);
    }

    /* 卡片级小标签，和总结卡的标签保持一致 */
    .kw-cornell-card-label {
        display: flex;
        align-items: center;
        gap: var(--size-2-2);
        padding: 0 var(--size-2-2);
        font-size: var(--font-ui-smaller);
        font-weight: 650;
        color: var(--text-muted);
    }

    .kw-cornell-card-icon {
        display: inline-flex;
        align-items: center;
        color: var(--kw-cornell-accent);
    }

    .kw-cornell-card-icon :global(svg) {
        width: 13px;
        height: 13px;
    }

    .kw-cornell-cue-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .kw-cornell-cue-line {
        display: flex;
        align-items: baseline;
        gap: var(--size-2-2);
        width: 100%;
        padding: var(--size-2-2) var(--size-2-2);
        border: none;
        border-radius: 6px;
        background: transparent;
        box-shadow: none;
        text-align: left;
        cursor: pointer;
        transition: background-color 0.14s ease;
    }

    .kw-cornell-cue-line:hover,
    .kw-cornell-cue-line.is-active {
        background: color-mix(in srgb, var(--kw-cornell-accent) 14%, transparent);
    }

    .kw-cornell-cue-index {
        flex: none;
        min-width: 1.25em;
        font-size: var(--font-ui-smaller);
        font-variant-numeric: tabular-nums;
        color: var(--text-faint);
    }

    .kw-cornell-cue-line:hover .kw-cornell-cue-index,
    .kw-cornell-cue-line.is-active .kw-cornell-cue-index {
        color: var(--kw-cornell-accent);
    }

    .kw-cornell-cue-text {
        font-size: var(--font-ui-small);
        font-weight: 650;
        line-height: 1.55;
        color: var(--text-normal);
        overflow-wrap: anywhere;
    }

    /* 正文卡：所有正文一篇 */
    .kw-cornell-note-card {
        min-width: 0;
        padding: var(--size-4-3);
        border-radius: 10px;
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
    }

    .kw-cornell-note-card.is-hint {
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
        line-height: 1.7;
        background: var(--background-secondary);
    }

    .kw-cornell-note-card.is-error {
        color: var(--text-error);
        background: var(--background-modifier-error-hover);
    }

    /* 总结卡：横贯全宽 */
    .kw-cornell-summary-card {
        padding: var(--size-4-2) var(--size-4-3);
        border-radius: 10px;
        background: color-mix(in srgb, var(--kw-cornell-accent) 5%, var(--background-primary));
        border: 1px solid color-mix(in srgb, var(--kw-cornell-accent) 26%, var(--background-modifier-border));
    }

    .kw-cornell-summary-label {
        display: flex;
        align-items: center;
        gap: var(--size-2-2);
        margin-bottom: var(--size-2-2);
        font-size: var(--font-ui-smaller);
        font-weight: 650;
        color: var(--text-muted);
    }

    .kw-cornell-summary-icon {
        display: inline-flex;
        align-items: center;
        color: var(--kw-cornell-accent);
    }

    /* 正文卡里的段标题：压小成小节标题，段间一条虚线，分得清是哪一段 */
    /*
     * 段标题：左右负外边距 + 等量内边距，文字仍与正文左对齐，
     * 但高亮色块能上下左右都留出余量（只给 padding-top 会让底部贴着文字收口）。
     */
    .kw-cornell-note-card :global(h2) {
        margin: var(--size-4-4) calc(-1 * var(--size-2-3)) var(--size-2-3);
        padding: var(--size-4-2) var(--size-2-3) var(--size-2-3);
        border-top: 1px dashed color-mix(in srgb, var(--text-faint) 30%, transparent);
        font-size: var(--font-ui-medium);
        font-weight: 650;
        line-height: 1.5;
        color: var(--text-normal);
    }

    .kw-cornell-note-card :global(h2:first-child) {
        margin-top: 0;
        padding-top: var(--size-2-3);
        border-top: none;
    }

    /* 悬停左侧线索时点亮对应段落 */
    .kw-cornell-note-card :global(h2.kw-cornell-linked) {
        border-radius: 6px;
        background: color-mix(in srgb, var(--kw-cornell-accent) 16%, transparent);
    }

    /* 卡片内 Markdown 收掉首尾外边距，行距交给卡片内边距 */
    .kw-cornell-note-card > div > :global(:first-child),
    .kw-cornell-summary-card > div > :global(:first-child) {
        margin-top: 0;
    }

    .kw-cornell-note-card > div > :global(:last-child),
    .kw-cornell-summary-card > div > :global(:last-child) {
        margin-bottom: 0;
    }

    /* 只读排版不响应任务勾选 */
    .kw-cornell-page :global(input[type="checkbox"]) {
        pointer-events: none;
    }

    /* 由 JS 创建，需要 :global 才不会被 Svelte 裁掉 */
    .kw-cornell-page :global(.kw-cornell-blank) {
        color: var(--text-faint);
        font-size: var(--font-ui-smaller);
    }
</style>
