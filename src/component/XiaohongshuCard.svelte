<script lang="ts">
    import type KeywordNotesPlugin from "../keywordNotesPlugin";
    import { Component, MarkdownRenderer, TFile, moment } from "obsidian";
    import { onDestroy, onMount } from "svelte";
    import type { XiaohongshuCard } from "../utils/xiaohongshuParser";
    import { getXiaohongshuTheme, type XiaohongshuThemeId } from "../utils/xiaohongshuThemes";

    export let plugin: KeywordNotesPlugin;
    export let file: TFile;
    export let card: XiaohongshuCard;
    export let themeId: XiaohongshuThemeId = "light";
    export let topRightText: string = "";
    export let bottomLeftText: string = "";
    export let noteColor: string | null = null;
    /** 是否允许点击图文页打开原笔记。 */
    export let openOnClick: boolean = true;

    let bodyEl: HTMLElement | null = null;
    let renderedBody: string | null = null;
    const renderHost = new Component();

    $: theme = getXiaohongshuTheme(themeId);
    $: layoutStyle = [
        `--kw-xhs-page-bg: ${theme.pageBackground}`,
        `--kw-xhs-text: ${theme.text}`,
        `--kw-xhs-muted: ${theme.muted}`,
        `--kw-xhs-title: ${theme.title}`,
        `--kw-xhs-accent: ${noteColor ?? theme.accent}`,
        `--kw-xhs-border: ${theme.border}`,
        `--kw-xhs-quote-bg: ${theme.quoteBackground}`,
        `--kw-xhs-quote-text: ${theme.quoteText}`,
        `--kw-xhs-code-bg: ${theme.codeBackground}`,
        `--kw-xhs-footer-bg: ${theme.footerBackground}`,
    ].join("; ");
    $: modifiedLabel = moment(file.stat.mtime).format("YYYY-MM-DD");

    onMount(() => {
        renderHost.load();
    });

    onDestroy(() => {
        renderHost.unload();
    });

    $: if (bodyEl && card) {
        const next = card.body;
        if (next !== renderedBody) {
            renderedBody = next;
            void renderBody(bodyEl, next);
        }
    }

    async function renderBody(node: HTMLElement, body: string) {
        node.empty();
        if (!body.trim()) {
            node.createDiv({ cls: "kw-xhs-blank", text: "（无正文）" });
            return;
        }
        await MarkdownRenderer.render(plugin.app, body, node, file.path, renderHost);
    }

    function openInMain() {
        void plugin.app.workspace.openLinkText(file.path, file.path, false);
    }
</script>

<div
    class="kw-xhs-card"
    style={layoutStyle}
>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
    <div
        class="kw-xhs-card-inner"
        on:click={openOnClick ? openInMain : null}
        on:keydown={(e) => openOnClick && e.key === "Enter" && openInMain()}
        role={openOnClick ? "link" : "article"}
        tabindex={openOnClick ? 0 : -1}
        title={card.cardTitle}
    >
        <header class="kw-xhs-page-header">
            <span>{theme.headerLabel ?? card.noteTitle}</span>
            <span>{topRightText || (theme.headerLabel ? card.noteTitle : `${card.cardIndex + 1} / ${card.total}`)}</span>
        </header>
        <h2 class="kw-xhs-page-title">{card.cardTitle}</h2>
        <div class="kw-xhs-body markdown-rendered" bind:this={bodyEl}></div>
        <footer class="kw-xhs-page-footer">
            <span>{bottomLeftText || modifiedLabel}</span>
            <span>{card.cardIndex + 1} / {card.total}</span>
        </footer>
    </div>
</div>

<style>
    .kw-xhs-card {
        width: 100%;
        display: flex;
        justify-content: center;
        padding: 0;
    }

    .kw-xhs-card-inner {
        position: relative;
        display: flex;
        flex-direction: column;
        width: min(560px, 100%);
        aspect-ratio: 3 / 4;
        padding: var(--size-4-5) var(--size-4-5) var(--size-4-8);
        overflow: hidden;
        border-radius: 8px;
        background: var(--kw-xhs-page-bg);
        border: 1px solid var(--kw-xhs-border);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
        cursor: pointer;
        transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
    }

    .kw-xhs-card-inner[role="article"] {
        cursor: default;
    }

    .kw-xhs-card-inner:hover,
    .kw-xhs-card-inner:focus-visible {
        transform: translateY(-1px);
        box-shadow: 0 10px 28px color-mix(in srgb, var(--kw-xhs-accent) 12%, transparent);
        border-color: color-mix(in srgb, var(--kw-xhs-accent) 45%, var(--kw-xhs-border));
        outline: none;
    }

    .kw-xhs-page-header,
    .kw-xhs-page-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: var(--kw-xhs-muted);
        font-size: var(--font-ui-smaller);
    }

    .kw-xhs-page-header {
        margin-bottom: var(--size-4-3);
    }

    .kw-xhs-page-header > span,
    .kw-xhs-page-footer > span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .kw-xhs-page-header > span + span,
    .kw-xhs-page-footer > span + span {
        flex-shrink: 0;
        max-width: 60%;
        margin-left: var(--size-4-3);
        text-align: right;
    }

    .kw-xhs-page-title {
        margin: 0 0 var(--size-4-3);
        color: var(--kw-xhs-title);
        font-size: 1.65em;
        font-weight: 700;
        line-height: 1.4;
    }

    .kw-xhs-body {
        flex: 1;
        min-height: 0;
        overflow: hidden;
        padding: 0;
        font-size: var(--font-ui-medium);
        line-height: 1.85;
        color: var(--kw-xhs-text);
    }

    .kw-xhs-body :global(h1),
    .kw-xhs-body :global(h2),
    .kw-xhs-body :global(h3),
    .kw-xhs-body :global(h4) {
        margin: var(--size-4-3) 0 var(--size-2-3);
        font-size: 1.15em;
        font-weight: 700;
        line-height: 1.4;
        color: var(--kw-xhs-title);
    }

    .kw-xhs-body :global(h1:first-child),
    .kw-xhs-body :global(h2:first-child),
    .kw-xhs-body :global(h3:first-child) {
        margin-top: 0;
    }

    .kw-xhs-body :global(p) {
        margin: 0 0 var(--size-2-3);
    }

    .kw-xhs-body :global(p:last-child) {
        margin-bottom: 0;
    }

    .kw-xhs-body :global(ul),
    .kw-xhs-body :global(ol) {
        margin: 0 0 var(--size-2-3);
        padding-left: var(--size-4-4);
    }

    .kw-xhs-body :global(blockquote) {
        margin: 0 0 var(--size-2-3);
        padding: var(--size-2-3) var(--size-4-3);
        border-left: 3px solid var(--kw-xhs-accent);
        background: var(--kw-xhs-quote-bg);
        border-radius: 0 6px 6px 0;
        color: var(--kw-xhs-quote-text);
    }

    .kw-xhs-body :global(pre) {
        margin: 0 0 var(--size-2-3);
        padding: var(--size-4-2);
        border-radius: 8px;
        background: var(--kw-xhs-code-bg);
        font-size: 0.9em;
        overflow: auto;
    }

    .kw-xhs-body :global(code) {
        font-size: 0.9em;
    }

    .kw-xhs-body :global(strong),
    .kw-xhs-body :global(b) {
        color: var(--kw-xhs-accent);
    }

    .kw-xhs-body :global(hr) {
        border-color: var(--kw-xhs-border);
    }

    .kw-xhs-body :global(a) {
        color: var(--kw-xhs-accent);
        text-decoration: none;
    }

    .kw-xhs-body :global(a:hover) {
        text-decoration: underline;
    }

    .kw-xhs-body :global(img) {
        max-width: 100%;
        max-height: 44%;
        height: auto;
        object-fit: contain;
        border-radius: 8px;
    }

    .kw-xhs-page-footer {
        position: absolute;
        right: var(--size-4-5);
        bottom: var(--size-4-3);
        left: var(--size-4-5);
        padding-top: var(--size-2-3);
        background: var(--kw-xhs-footer-bg);
    }

    /* 由 JS 创建，需要 :global 才不会被 Svelte 裁掉 */
    .kw-xhs-body :global(.kw-xhs-blank) {
        color: var(--text-faint);
        font-size: var(--font-ui-small);
        text-align: center;
        padding: var(--size-4-3) 0;
    }
</style>
