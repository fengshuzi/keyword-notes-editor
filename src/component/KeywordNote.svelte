<script lang="ts">
    import type KeywordNotesPlugin from "../keywordNotesPlugin";
    import { MarkdownRenderer, MarkdownView, Menu, Platform, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
    import { KeywordNoteEditor, spawnLeafView } from "../leafView";
    import { NOTE_COLORS } from "../keywordNoteSettings";
    import { onDestroy, onMount } from "svelte";

    export let file: TAbstractFile;
    export let plugin: KeywordNotesPlugin;
    export let leaf: WorkspaceLeaf;
    export let shouldRender: boolean = true;
    export let collapseAll: boolean | null = null;
    export let onIndividualToggle: (() => void) | null = null;
    export let onDeleteNote: ((file: TFile) => Promise<void>) | null = null;
    export let isPinned: boolean = false;
    export let onTogglePinned: ((file: TFile, pinned: boolean) => Promise<void>) | null = null;
    export let noteColor: string | null = null;
    export let onSetNoteColor: ((file: TFile, color: string | null) => void) | null = null;
    export let selectedPath: string | null = null;
    export let onSelectNote: ((file: TFile) => void) | null = null;

    let editorEl: HTMLElement;
    let mobilePreviewEl: HTMLElement;
    let containerEl: HTMLElement;
    let title: string;
    const isMobilePreview = Platform.isMobile && (plugin.settings.mobileNoteMode || "editable") === "preview";
    let renderedPreviewPath = "";

    let rendered: boolean = false;

    let createdLeaf: WorkspaceLeaf | null = null;
    let createdEditor: KeywordNoteEditor | null = null;
    let unloadTimeout: number | null = null;
    let editorHeight: number = 100;
    
    let isDestroying = false;
    let isDeleting = false;
    let isCollapsed: boolean = false;
    let hasReadableLineWidth: boolean = false;

    onMount(() => {
        if (file instanceof TFile) {
            title = file.basename;
        }
    });

    $: if (!isMobilePreview && editorEl && shouldRender && !rendered) {
        showEditor();
    } else if (!isMobilePreview && editorEl && !shouldRender && rendered) {
        scheduleUnload();
    }

    $: if (isMobilePreview && mobilePreviewEl && shouldRender && file instanceof TFile && renderedPreviewPath !== file.path) {
        renderedPreviewPath = file.path;
        void renderMobilePreview(file);
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

    async function renderMobilePreview(fileToRender: TFile) {
        if (!mobilePreviewEl) return;

        mobilePreviewEl.empty();
        mobilePreviewEl.createDiv({ text: "Loading...", cls: "editor-placeholder" });

        try {
            const source = await plugin.app.vault.cachedRead(fileToRender);
            if (!mobilePreviewEl || renderedPreviewPath !== fileToRender.path) return;

            mobilePreviewEl.empty();
            await MarkdownRenderer.render(
                plugin.app,
                source || "_Empty note_",
                mobilePreviewEl,
                fileToRender.path,
                plugin
            );
        } catch (error) {
            if (!mobilePreviewEl) return;
            mobilePreviewEl.empty();
            mobilePreviewEl.createDiv({
                text: "Failed to render note preview",
                cls: "editor-placeholder",
            });
            console.error("Keyword Notes Editor: failed to render mobile preview", error);
        }
    }

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
            
            [createdLeaf, createdEditor] = spawnLeafView(plugin, editorEl, leaf);
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
            void fileName;
            
            if (createdEditor) {
                createdEditor.hide();
            } else if (createdLeaf.detach) {
                createdLeaf.detach();
            }
            
            rendered = false;
            createdLeaf = null;
            createdEditor = null;
        } catch (error) {
            console.error("Error unloading editor:", error);
        }
    }
    
    function handleFileIconClick() {
        if (!(file instanceof TFile)) return;
        const fileToOpen = file;
        plugin.app.workspace.openLinkText(fileToOpen.path, fileToOpen.path, false);
    }

    function handleEditorClick() {
        selectNote();
        const editor = (createdLeaf?.view as unknown as { editMode?: { editor?: { hasFocus: () => boolean; focus: () => void } } })?.editMode?.editor;
        if (editor && !editor.hasFocus()) {
            editor.focus();
        }
    }

    function selectNote() {
        if (file instanceof TFile && onSelectNote) {
            onSelectNote(file);
        }
    }

    function handleFocusIn() {
        selectNote();
    }

    $: isSelected = file instanceof TFile && selectedPath === file.path;
    $: noteColorStyle = noteColor ? `--kw-note-card-accent: ${noteColor}; --kw-note-dot-color: ${noteColor};` : "";

    $: displayedCollapsed = collapseAll !== null ? collapseAll : isCollapsed;

    $: if (collapseAll !== null) {
        isCollapsed = collapseAll;
    }

    function setCollapsed(nextCollapsed: boolean) {
        if (collapseAll !== null && onIndividualToggle) {
            onIndividualToggle();
        }
        isCollapsed = nextCollapsed;
    }

    function handleCollapseContextMenu(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        selectNote();

        const menu = new Menu();
        menu.addItem((item) => {
            item
                .setTitle(displayedCollapsed ? "展开笔记" : "折叠笔记")
                .setIcon(displayedCollapsed ? "chevron-down" : "chevron-right")
                .onClick(() => setCollapsed(!displayedCollapsed));
        });
        menu.addItem((item) => {
            item
                .setTitle(isPinned ? "取消置顶" : "置顶笔记")
                .setIcon("pin")
                .setChecked(isPinned)
                .onClick(() => {
                    void handleTogglePinned();
                });
        });
        menu.addItem((item) => {
            item
                .setTitle("颜色标记")
                .setIcon("palette")
                .onClick(() => {
                    const colorMenu = new Menu();
                    for (const { label, value } of NOTE_COLORS) {
                        colorMenu.addItem((ci) => {
                            ci.setTitle(label)
                                .setChecked(noteColor === value)
                                .onClick(() => {
                                    if (onSetNoteColor && file instanceof TFile) {
                                        onSetNoteColor(file, value);
                                    }
                                });
                        });
                    }
                    colorMenu.showAtMouseEvent(event);
                });
        });
        menu.addSeparator();
        menu.addItem((item) => {
            item
                .setTitle(isDeleting ? "正在删除..." : "删除笔记")
                .setIcon("trash")
                .setWarning(true)
                .setDisabled(isDeleting)
                .onClick(() => {
                    void handleDelete();
                });
        });
        menu.showAtMouseEvent(event);
    }

    function handleDotMouseDown(event: MouseEvent) {
        selectNote();
        if (event.button === 2) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    async function handleDelete() {
        if (!(file instanceof TFile)) return;
        if (isDeleting) return;

        isDeleting = true;
        try {
            if (onDeleteNote) {
                await onDeleteNote(file);
            } else {
                await plugin.app.vault.trash(file, false);
            }
        } catch (error) {
            isDeleting = false;
            console.error("Keyword Notes Editor: failed to delete note", error);
        }
    }

    async function handleTogglePinned() {
        if (!(file instanceof TFile)) return;
        if (!onTogglePinned) return;

        try {
            await onTogglePinned(file, !isPinned);
        } catch (error) {
            console.error("Keyword Notes Editor: failed to update pinned note", error);
        }
    }
</script>

<div
    class="keyword-note-container"
    class:is-collapsed={displayedCollapsed}
    class:is-pinned={isPinned}
    class:is-selected={isSelected}
    class:has-readable-line-width={hasReadableLineWidth}
        data-id='kw-editor-{file.path}'
        bind:this={containerEl}
        style="min-height: {displayedCollapsed || isMobilePreview ? 'auto' : editorHeight + 'px'}; {noteColorStyle}"
        on:focusin={handleFocusIn}
    >
    <div class="keyword-note">
        {#if title}
            <div class="keyword-note-title">
                <!-- svelte-ignore a11y-interactive-supports-focus -->
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <span
                    role="button"
                    data-collapsed={displayedCollapsed}
                    class="agenda-dot-button"
                    on:mousedown={handleDotMouseDown}
                    on:contextmenu={handleCollapseContextMenu}
                ></span>
                <!-- svelte-ignore a11y-interactive-supports-focus -->
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <span role="link" class="clickable-link" on:click={handleFileIconClick} data-title={title}>{title}</span>
            </div>
        {/if}
        {#if isMobilePreview}
            <div
                class="keyword-note-mobile-preview markdown-rendered"
                data-collapsed={displayedCollapsed}
                bind:this={mobilePreviewEl}
                data-title={title}
            ></div>
        {:else}
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
        {/if}
    </div>
</div>

<style>
    .keyword-note {
        margin-bottom: var(--size-4-5);
        padding-bottom: var(--size-4-8);
    }

    .keyword-note-container {
        --kw-note-card-accent: var(--keyword-notes-default-color, #ffb000);
        border: 1px solid transparent;
        border-radius: 10px;
        transition: background-color 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
    }

    .keyword-note-container.is-selected {
        background:
            linear-gradient(
                180deg,
                color-mix(in srgb, var(--kw-note-card-accent) 7%, var(--background-primary)) 0%,
                color-mix(in srgb, var(--kw-note-card-accent) 4%, var(--background-primary)) 100%
            );
        border-color: color-mix(in srgb, var(--kw-note-card-accent) 58%, var(--background-modifier-border));
        box-shadow:
            0 1px 0 color-mix(in srgb, var(--kw-note-card-accent) 18%, transparent),
            0 10px 28px color-mix(in srgb, var(--kw-note-card-accent) 8%, transparent);
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

    .keyword-note-mobile-preview {
        padding: 0 var(--size-4-4) var(--size-4-3);
    }

    .keyword-note-mobile-preview[data-collapsed="true"] {
        display: none;
    }

    .has-readable-line-width .keyword-note-title {
        display: flex;
        align-items: center;
        justify-content: start;
        margin-bottom: var(--size-4-8);
        padding-left: var(--size-4-4);
        gap: var(--size-4-2);
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

    .agenda-dot-button {
        --kw-note-dot-color: var(--kw-note-card-accent, var(--keyword-notes-default-color, #ffb000));
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        margin-left: 0;
        border-radius: 999px;
        cursor: pointer;
        flex-shrink: 0;
    }

    .agenda-dot-button::before {
        content: "";
        width: 13px;
        height: 13px;
        border: 2px solid var(--kw-note-dot-color);
        border-radius: 999px;
        background: color-mix(in srgb, var(--kw-note-dot-color) 16%, transparent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--kw-note-dot-color) 12%, transparent);
        transition: transform 0.16s ease, background-color 0.16s ease, box-shadow 0.16s ease;
    }

    .agenda-dot-button::after {
        content: "";
        position: absolute;
        width: 5px;
        height: 5px;
        border-radius: 999px;
        background: var(--kw-note-dot-color);
        transition: opacity 0.16s ease, transform 0.16s ease;
    }

    .agenda-dot-button[data-collapsed="true"]::before {
        background: transparent;
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--kw-note-dot-color) 10%, transparent);
    }

    .agenda-dot-button[data-collapsed="true"]::after {
        opacity: 0;
        transform: scale(0.4);
    }

    .is-pinned .agenda-dot-button::before {
        background: color-mix(in srgb, var(--kw-note-dot-color) 32%, transparent);
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--kw-note-dot-color) 16%, transparent);
    }

    .is-pinned .clickable-link::after {
        content: "置顶";
        margin-left: var(--size-2-3);
        padding: 1px 6px;
        border-radius: 999px;
        color: var(--kw-note-dot-color);
        background: color-mix(in srgb, var(--kw-note-dot-color) 12%, transparent);
        font-size: var(--font-ui-smaller);
        font-weight: 500;
        vertical-align: middle;
    }

    .clickable-link {
        cursor: pointer;
        text-decoration: none;
        font-size: var(--inline-title-size, 1.5em);
        font-weight: var(--inline-title-weight, 700);
        font-style: var(--inline-title-style, normal);
        color: var(--text-normal);
        line-height: 1.3;
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
    
</style>
