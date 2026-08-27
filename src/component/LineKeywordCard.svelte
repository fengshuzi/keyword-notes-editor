<script lang="ts">
    import { MarkdownRenderer, TFile } from "obsidian";
    import { onDestroy } from "svelte";
    import type KeywordNotesPlugin from "../keywordNotesPlugin";

    export let file: TFile;
    export let lines: string[];
    export let plugin: KeywordNotesPlugin;

    let contentEl: HTMLElement;
    let renderVersion = 0;

    async function renderLines() {
        if (!contentEl) return;
        const version = ++renderVersion;
        const staging = document.createElement("div");
        await MarkdownRenderer.render(plugin.app, lines.join("\n"), staging, file.path, plugin);
        if (version !== renderVersion || !contentEl) return;
        contentEl.empty();
        while (staging.firstChild) contentEl.appendChild(staging.firstChild);
    }

    function openFile() {
        void plugin.app.workspace.openLinkText(file.path, file.path, false);
    }

    $: if (contentEl && lines) void renderLines();
    onDestroy(() => { renderVersion += 1; });
</script>

<article class="kw-line-keyword-card">
    <button type="button" class="kw-line-keyword-date" on:click={openFile} title="打开完整日记">
        {file.basename}
    </button>
    <div
        class="kw-line-keyword-content"
        bind:this={contentEl}
        role="button"
        tabindex="0"
        title="双击打开完整日记"
        on:dblclick={openFile}
        on:keydown={(event) => { if (event.key === "Enter") openFile(); }}
    ></div>
</article>

<style>
    .kw-line-keyword-card {
        border: 1px solid var(--background-modifier-border);
        border-radius: var(--radius-m);
        background: var(--background-primary);
        padding: var(--size-4-3) var(--size-4-4);
        margin-bottom: var(--size-4-3);
    }

    .kw-line-keyword-date {
        border: 0;
        background: transparent;
        color: var(--text-muted);
        font-size: var(--font-ui-small);
        font-weight: var(--font-semibold);
        padding: 0 0 var(--size-4-2);
        cursor: pointer;
    }

    .kw-line-keyword-date:hover { color: var(--text-accent); }
    .kw-line-keyword-content :global(ul) { margin-block: 0; }
    .kw-line-keyword-content :global(li) { margin-block: var(--size-4-1); }
</style>
