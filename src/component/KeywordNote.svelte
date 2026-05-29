<script lang="ts">
    import type KeywordNotesPlugin from "../keywordNotesPlugin";
    import { MarkdownView, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
    import { spawnLeafView } from "../leafView";
    import { onDestroy, onMount } from "svelte";

    export let file: TAbstractFile;
    export let plugin: KeywordNotesPlugin;
    export let leaf: WorkspaceLeaf;
    export let shouldRender: boolean = true;
    export let collapseAll: boolean | null = null;
    export let onIndividualToggle: (() => void) | null = null;

    let editorEl: HTMLElement;
    let containerEl: HTMLElement;
    let title: string;

    let rendered: boolean = false;

    let createdLeaf: WorkspaceLeaf;
    let unloadTimeout: number | null = null;
    let editorHeight: number = 100;
    
    let isDestroying = false;
    let isCollapsed: boolean = false;
    let hasReadableLineWidth: boolean = false;

    onMount(() => {
        if (file instanceof TFile) {
            title = file.basename;
        }
    });

    $: if (editorEl && shouldRender && !rendered) {
        showEditor();
    } else if (editorEl && !shouldRender && rendered) {
        scheduleUnload();
    }

    onDestroy(() => {
        isDestroying = true;
        if (unloadTimeout) {
            window.clearTimeout(unloadTimeout);
        }
        if (rendered && createdLeaf) {
            unloadEditor();
        }
    });

    function showEditor() {
        if (!(file instanceof TFile)) return;
        if (rendered) return;
        if (isDestroying) return;
        
        if (unloadTimeout) {
            window.clearTimeout(unloadTimeout);
            unloadTimeout = null;
        }

        try {
            const fileName = file instanceof TFile ? file.basename : "unknown";
            
            [createdLeaf] = spawnLeafView(plugin, editorEl, leaf);
            createdLeaf.setPinned(true);

            createdLeaf.setViewState({
                type: "markdown",
                state: {
                    file: file.path,
                    mode: "source",
                    source: false,
                    backlinks: !plugin.settings.hideBacklinks,
                    backlinkOpts: {
                        collapseAll: false,
                        extraContext: false,
                        sortOrder: "alphabetical",
                        showSearch: false,
                        searchQuery: "",
                        backlinkCollapsed: false,
                        unlinkedCollapsed: true
                    }
                }
            });
            createdLeaf.parentLeaf = leaf;

            rendered = true;
            
            const timeout = window.setTimeout(() => {
                if (createdLeaf && containerEl) {
                    if(!(createdLeaf.view instanceof MarkdownView)) return; 
                    const h = (createdLeaf.view as unknown as { editMode?: { editor?: { cm?: { dom?: { innerHeight?: number } } } } }).editMode?.editor?.cm?.dom?.innerHeight;
                    if (typeof h === "number" && h > 0) {
                        editorHeight = h;
                        containerEl.style.minHeight = `${h}px`;
                        // Check for readable line width class on the editor
                        const cmEditor = containerEl.querySelector('.cm-editor');
                        if (cmEditor) {
                            hasReadableLineWidth = cmEditor.classList.contains('is-readable-line-width');
                        }

                        window.clearTimeout(timeout);
                    }
                }
            }, 400);
        } catch (error) {
            console.error("Error creating leaf view:", error);
        }
    }
    
    function scheduleUnload() {
        if (unloadTimeout) {
            window.clearTimeout(unloadTimeout);
        }
        
        unloadTimeout = window.setTimeout(() => {
            if (!shouldRender && rendered) {
                unloadEditor();
            }
        }, 1000);
    }
    
    function unloadEditor() {
        if (!rendered || !createdLeaf) return;
        
        try {
            const fileName = file instanceof TFile ? file.basename : "unknown";
            
            if (createdLeaf.detach) {
                createdLeaf.detach();
            }
            
            if (editorEl) {
                editorEl.empty();
            }
            
            rendered = false;
        } catch (error) {
            console.error("Error unloading editor:", error);
        }
    }
    
    function handleFileIconClick() {
        if (!(file instanceof TFile)) return;
        const fileToOpen = file;
        plugin.app.workspace.openLinkText(fileToOpen.path, fileToOpen.path, false);
    }

    function handleCollapseClick() {
        toggleCollapse();
    }

    function handleEditorClick() {
        const editor = (createdLeaf?.view as unknown as { editMode?: { editor?: { hasFocus: () => boolean; focus: () => void } } })?.editMode?.editor;
        if (editor && !editor.hasFocus()) {
            editor.focus();
        }
    }
    
    $: displayedCollapsed = collapseAll !== null ? collapseAll : isCollapsed;

    $: if (collapseAll !== null) {
        isCollapsed = collapseAll;
    }

    function toggleCollapse() {
        if (collapseAll !== null && onIndividualToggle) {
            onIndividualToggle();
        }
        isCollapsed = !displayedCollapsed;
    }
</script>

<div class="keyword-note-container" class:is-collapsed={displayedCollapsed} class:has-readable-line-width={hasReadableLineWidth} data-id='kw-editor-{file.path}' bind:this={containerEl} style="min-height: {displayedCollapsed ? 'auto' : editorHeight + 'px'};">
    <div class="keyword-note">
        {#if title}
            <div class="keyword-note-title inline-title">
                <!-- svelte-ignore a11y-interactive-supports-focus -->
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <span role="button" data-collapsed={displayedCollapsed} class="collapse-button" on:click={handleCollapseClick} title={displayedCollapsed ? "展开" : "折叠"}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down"><path d="m6 9 6 6 6-6"/></svg>
                </span>
                <!-- svelte-ignore a11y-interactive-supports-focus -->
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <span role="link" class="clickable-link" on:click={handleFileIconClick} data-title={title}>{title}</span>
            </div>
        {/if}
        <div
            class="keyword-note-editor"
            data-collapsed={displayedCollapsed}
            bind:this={editorEl}
            data-title={title}
            role="button"
            tabindex="0"
            on:click={handleEditorClick}
            on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), handleEditorClick())}
        >
            {#if !rendered && shouldRender}
                <div class="editor-placeholder">Loading...</div>
            {/if}
            {#if !shouldRender && !rendered}
                <div class="editor-placeholder">Scroll to view content</div>
            {/if}
        </div>
    </div>
</div>

<style>
    .keyword-note {
        margin-bottom: var(--size-4-5);
        padding-bottom: var(--size-4-8);
    }

    .is-collapsed .keyword-note {
        margin-bottom: 0;
        padding-bottom: 0;
    }

    .keyword-note-editor {
        min-height: 100px;
    }

    .keyword-note-editor[data-collapsed="true"] {
        display: none;
    }

    .keyword-note .collapse-button {
        display: none;
    }

    .keyword-note:hover .collapse-button {
        display: block;
    }

    .keyword-note .collapse-button {
        color: var(--text-muted);
    }

    .keyword-note .collapse-button:hover  {
        color: var(--text-normal);
    }

    .has-readable-line-width .keyword-note-title {
        display: flex;
        align-items: center;
        justify-content: start;
        margin-bottom: var(--size-4-8);
        padding-left: var(--size-4-4);
        gap: var(--size-4-2);
    }

    .collapse-button {
        margin-left: 0;
    }

    .collapse-button[data-collapsed="true"] {
        transform: rotate(-90deg);

        transition: transform 0.2s ease;
    }

    .keyword-note-container:not(.has-readable-line-width) .keyword-note-title {
        display: flex;
        justify-content: start;
        align-items: center;
        width: 100%;
        padding-left: var(--size-4-4);
        margin-top: var(--size-4-8);
        gap: var(--size-4-2);
    }

    .clickable-link {
        cursor: pointer;
        text-decoration: none;
    }

    .clickable-link:hover {
        color: var(--color-accent);
        text-decoration: underline;
    }
    
    .editor-placeholder {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100px;
        color: var(--text-muted);
        font-style: italic;
    }
    
    .collapse-button {
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        color: var(--text-muted);
        transition: background-color 0.2s ease;
    }
    
    .collapse-button:hover {
        color: var(--text-normal);
    }
</style>
