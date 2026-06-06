<script lang="ts">
    import type KeywordNotesPlugin from "../keywordNotesPlugin";
    import type { WorkspaceLeaf } from "obsidian";

    import { Platform, TFile, moment } from "obsidian";
    import KeywordNote from "./KeywordNote.svelte";
    import { inview } from "svelte-inview";
    import { SelectionMode, TimeField } from "../types/time";
    import { onMount, tick } from "svelte";
    import { FileManager, FileManagerOptions } from "../utils/fileManager";


    export let plugin: KeywordNotesPlugin;
    export let leaf: WorkspaceLeaf;
    export let selectionMode: SelectionMode = "tag";
    export let target: string = "";
    export let timeField: TimeField = "mtime";
    export let includeSubTags: boolean = false;
    
    // Global collapse state: true = all collapsed, false = all expanded, null = individual states
    export let collapseAll: boolean | null = null;
    
    let renderedFiles: TFile[] = [];
    let filteredFiles: TFile[] = [];
    
    // Track which notes are in viewport
    let visibleNotes: Set<string> = new Set();
    let deletingPaths: Set<string> = new Set();
    let pinnedPaths: Set<string> = new Set();
    let noteColors: Map<string, string> = new Map();
    let selectedNotePath: string | null = null;

    let hasMore = true;
    let firstLoaded = true;
    let loaderRef: HTMLDivElement;
    let resetVersion = 0;
    let mobileFillTimer: number | null = null;

    // Create the file manager
    let fileManager: FileManager;

    $: pinnedScopeKey = plugin.getPinnedScopeKey(selectionMode, target, includeSubTags);
    
    $: fileManagerOptions = {
        mode: selectionMode,
        target: target,
        app: plugin.app,
        timeField: timeField,
        includeSubTags: includeSubTags,
        excludedFolders: selectionMode === "tag" ? (plugin.settings.excludedFolders || []) : [],
        journalFolders: plugin.settings.journalFolders || ["journals"]
    } as FileManagerOptions;

    $: if (fileManager && (selectionMode !== fileManager.options.mode ||
                          target !== fileManager.options.target ||
                          timeField !== fileManager.options.timeField ||
                          includeSubTags !== fileManager.options.includeSubTags)) {
        fileManager.updateOptions({
            mode: selectionMode,
            target: target,
            timeField: timeField,
            includeSubTags: includeSubTags,
            excludedFolders: selectionMode === "tag" ? (plugin.settings.excludedFolders || []) : [],
            journalFolders: plugin.settings.journalFolders || ["journals"]
        });
        
        void resetRenderedFiles();
    }

    onMount(() => {
        fileManager = new FileManager(fileManagerOptions);
        void resetRenderedFiles();
    });

    export function refresh() {
        if (!fileManager) return;
        plugin.prunePinnedNotes(pinnedScopeKey);
        fileManager.forceRefresh();
        void resetRenderedFiles();
    }

    async function resetRenderedFiles() {
        const version = ++resetVersion;
        if (mobileFillTimer) {
            window.clearTimeout(mobileFillTimer);
            mobileFillTimer = null;
        }
        renderedFiles = [];
        filteredFiles = [];
        visibleNotes = new Set();
        selectedNotePath = null;
        hasMore = false;
        firstLoaded = true;

        // Give Svelte a DOM turn to destroy old embedded editor leaves before new notes mount.
        await tick();
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        if (version !== resetVersion) return;

        syncPinnedPaths();
        syncNoteColors();
        filteredFiles = getScopedFilteredFiles();
        hasMore = filteredFiles.length > 0;
        firstLoaded = true;
        startFillViewport();
    }

    export function foldAll() {
        collapseAll = true;
    }

    export function expandAll() {
        collapseAll = false;
        for (const file of renderedFiles) {
            visibleNotes.add(file.path);
        }
        visibleNotes = visibleNotes;
    }

    function clearCollapseAll() {
        collapseAll = null;
    }

    // ── Infinite scroll ────────────────────────────────────

    function startFillViewport() {
        if (!firstLoaded || !filteredFiles.length) {
            return;
        }
        fillViewport();
        firstLoaded = false;
    }

    function fillViewport() {
        if (!loaderRef || !filteredFiles.length || !hasMore) return;
        const startIndex = renderedFiles.length;
        const batchSize = isMobileEditableMode() ? 1 : 10;
        const endIndex = Math.min(startIndex + batchSize, filteredFiles.length);
        const newFiles = filteredFiles.slice(startIndex, endIndex);
        renderedFiles = [...renderedFiles, ...newFiles];
        if (startIndex === 0) {
            for (const f of newFiles) {
                visibleNotes.add(f.path);
            }
            visibleNotes = visibleNotes;
        }
        if (endIndex >= filteredFiles.length) {
            hasMore = false;
        }
        scheduleMobileFillIfNeeded();
    }

    function scheduleMobileFillIfNeeded() {
        if (!isMobileEditableMode() || !hasMore || !loaderRef || mobileFillTimer) return;

        mobileFillTimer = window.setTimeout(() => {
            mobileFillTimer = null;
            if (!loaderRef || !hasMore) return;

            const rect = loaderRef.getBoundingClientRect();
            const viewportHeight = window.innerHeight || leaf.view.contentEl.clientHeight;
            if (rect.top < viewportHeight + 200) {
                fillViewport();
            }
        }, 150);
    }

    function isMobileEditableMode() {
        return Platform.isMobile && (plugin.settings.mobileNoteMode || "editable") === "editable";
    }

    function stopFillViewport() {
        if (mobileFillTimer) {
            window.clearTimeout(mobileFillTimer);
            mobileFillTimer = null;
        }
    }

    function infiniteHandler(e: CustomEvent<{ inView: boolean }>) {
        if (e.detail.inView && hasMore) {
            fillViewport();
        }
    }

    function updateHasMore() {
        hasMore = renderedFiles.length < filteredFiles.length;
    }

    function syncPinnedPaths() {
        pinnedPaths = new Set(plugin.getPinnedNotePaths(pinnedScopeKey));
    }

    function syncNoteColors() {
        noteColors = new Map(Object.entries(plugin.settings.noteColors ?? {}));
    }

    function applyPinnedOrder(files: TFile[]): TFile[] {
        if (pinnedPaths.size === 0) return files;

        const order = new Map([...pinnedPaths].map((path, index) => [path, index]));
        return [...files].sort((a, b) => {
            const aIndex = order.get(a.path);
            const bIndex = order.get(b.path);

            if (aIndex !== undefined && bIndex !== undefined) {
                return aIndex - bIndex;
            }
            if (aIndex !== undefined) return -1;
            if (bIndex !== undefined) return 1;
            return files.indexOf(a) - files.indexOf(b);
        });
    }

    function getScopedFilteredFiles(): TFile[] {
        return applyPinnedOrder(fileManager.getFilteredFiles());
    }

    function pruneVisibleNotes() {
        const renderedPaths = new Set(renderedFiles.map((f) => f.path));
        visibleNotes = new Set([...visibleNotes].filter((path) => renderedPaths.has(path)));
    }

    async function deleteNote(file: TFile) {
        if (deletingPaths.has(file.path)) return;
        deletingPaths.add(file.path);
        if (selectedNotePath === file.path) {
            selectedNotePath = null;
        }
        plugin.removePinnedNotePath(file.path);
        syncPinnedPaths();
        syncNoteColors();

        filteredFiles = filteredFiles.filter((f) => f.path !== file.path);
        renderedFiles = renderedFiles.filter((f) => f.path !== file.path);
        pruneVisibleNotes();
        updateHasMore();

        // Let Svelte destroy the embedded editor leaf before Obsidian deletes the file.
        await tick();

        try {
            await plugin.app.vault.trash(file, false);
        } catch (error) {
            deletingPaths.delete(file.path);
            refresh();
            throw error;
        }
    }

    export function fileCreate(file: TFile) {
        const loadedCount = renderedFiles.length;
        fileManager.fileCreate(file);
        syncPinnedPaths();
        syncNoteColors();
        filteredFiles = getScopedFilteredFiles();
        
        const newIndex = filteredFiles.findIndex((f) => f.path === file.path);
        if (newIndex >= 0 && newIndex <= loadedCount) {
            renderedFiles = filteredFiles.slice(0, Math.min(loadedCount + 1, filteredFiles.length));
            visibleNotes.add(file.path);
            visibleNotes = visibleNotes;
        }
        updateHasMore();
    }

    export function fileDelete(file: TFile) {
        fileManager.fileDelete(file);
        deletingPaths.delete(file.path);
        if (selectedNotePath === file.path) {
            selectedNotePath = null;
        }
        plugin.removePinnedNotePath(file.path);
        syncPinnedPaths();
        syncNoteColors();
        filteredFiles = getScopedFilteredFiles();
        
        renderedFiles = renderedFiles.filter((f) => {
            return f.path !== file.path;
        });
        pruneVisibleNotes();
        
        if (visibleNotes.has(file.path)) {
            visibleNotes.delete(file.path);
            visibleNotes = visibleNotes;
        }
        updateHasMore();
    }

    export function fileRename() {
        refresh();
    }

    async function togglePinned(file: TFile, pinned: boolean) {
        await plugin.setNotePinned(pinnedScopeKey, file, pinned);
        syncPinnedPaths();
        syncNoteColors();

        const loadedCount = Math.max(renderedFiles.length, 1);
        filteredFiles = getScopedFilteredFiles();
        renderedFiles = filteredFiles.slice(0, Math.min(loadedCount, filteredFiles.length));
        pruneVisibleNotes();
        if (renderedFiles.some((f) => f.path === file.path)) {
            visibleNotes.add(file.path);
            visibleNotes = visibleNotes;
        }
        updateHasMore();
    }
    
    async function setNoteColor(file: import('obsidian').TFile, color: string | null) {
        plugin.setNoteColor(file.path, color);
        syncNoteColors();
    }

    function selectNote(file: TFile) {
        selectedNotePath = file.path;
    }

    function handleNoteVisibilityChange(file: TFile, isVisible: boolean) {
        if (isVisible) {
            visibleNotes.add(file.path);
        } else {
            visibleNotes.delete(file.path);
        }
        visibleNotes = visibleNotes;
    }
</script>

<div class="keyword-note-view">
    {#if renderedFiles.length === 0}
        <div class="kw-stock">
            <div class="kw-stock-text">
                No files found
            </div>
        </div>
    {/if}
    {#each renderedFiles as file (file.path)}
        <div class="keyword-note-wrapper" use:inview={{
            rootMargin: "80%",
            unobserveOnEnter: false,
            root: leaf.view.contentEl
        }} on:inview_change={({ detail }) => handleNoteVisibilityChange(file, detail.inView)}>
            <KeywordNote 
                file={file} 
                plugin={plugin} 
                leaf={leaf} 
                shouldRender={visibleNotes.has(file.path)}
                collapseAll={collapseAll}
                onIndividualToggle={clearCollapseAll}
                onDeleteNote={deleteNote}
                isPinned={pinnedPaths.has(file.path)}
                onTogglePinned={togglePinned}
                noteColor={noteColors.get(file.path) ?? null}
                onSetNoteColor={setNoteColor}
                selectedPath={selectedNotePath}
                onSelectNote={selectNote}
            />
        </div>
    {/each}
    <div bind:this={loaderRef} class="kw-view-loader" use:inview={{
        root: leaf.view.containerEl
    }} on:inview_init={startFillViewport} on:inview_change={infiniteHandler}
         on:inview_leave={stopFillViewport}/>
    {#if !hasMore}
        <div class="no-more-text">
            <span class="no-more-line"></span>
            <span class="no-more-message">到底啦，知识仓鼠已经翻完库存。</span>
            <span class="no-more-line"></span>
        </div>
    {/if}
</div>


<style>
    .kw-stock {
        height: 1000px;
        width: 100%;

        display: flex;
        justify-content: center;
        align-items: center;
    }

    .kw-stock-text {
        text-align: center;
    }

    .no-more-text {
        display: flex;
        align-items: center;
        gap: var(--size-4-3);
        margin: var(--size-4-6) auto var(--size-4-4);
        color: var(--text-muted);
        font-size: var(--font-ui-small);
        text-align: center;
        white-space: nowrap;
        width: min(520px, 86%);
    }

    .no-more-line {
        flex: 1;
        height: 1px;
        background: linear-gradient(
            90deg,
            transparent,
            color-mix(in srgb, var(--text-muted) 36%, transparent),
            transparent
        );
    }

    .no-more-message {
        opacity: 0.82;
    }
    
    .keyword-note-wrapper {
        width: 100%;
    }
</style>
