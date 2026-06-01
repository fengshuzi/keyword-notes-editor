<script lang="ts">
    import type KeywordNotesPlugin from "../keywordNotesPlugin";
    import type { WorkspaceLeaf } from "obsidian";

    import { TFile, moment } from "obsidian";
    import KeywordNote from "./KeywordNote.svelte";
    import { inview } from "svelte-inview";
    import { TimeRange, SelectionMode, TimeField } from "../types/time";
    import { onMount } from "svelte";
    import { FileManager, FileManagerOptions } from "../utils/fileManager";


    export let plugin: KeywordNotesPlugin;
    export let leaf: WorkspaceLeaf;
    export let selectedRange: TimeRange = "all";
    export let customRange: { start: Date; end: Date } | null = null;
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

    let hasMore = true;
    let firstLoaded = true;
    let loaderRef: HTMLDivElement;

    // Create the file manager
    let fileManager: FileManager;
    
    $: fileManagerOptions = {
        mode: selectionMode,
        target: target,
        timeRange: selectedRange,
        customRange: customRange,
        app: plugin.app,
        timeField: timeField,
        includeSubTags: includeSubTags,
        excludedFolders: selectionMode === "tag" ? (plugin.settings.excludedFolders || []) : []
    } as FileManagerOptions;

    $: if (fileManager && (selectedRange !== fileManager.options.timeRange || 
                          customRange !== fileManager.options.customRange ||
                          selectionMode !== fileManager.options.mode ||
                          target !== fileManager.options.target ||
                          timeField !== fileManager.options.timeField ||
                          includeSubTags !== fileManager.options.includeSubTags)) {
        fileManager.updateOptions({
            timeRange: selectedRange,
            customRange: customRange,
            mode: selectionMode,
            target: target,
            timeField: timeField,
            includeSubTags: includeSubTags,
            excludedFolders: selectionMode === "tag" ? (plugin.settings.excludedFolders || []) : []
        });
        
        // Reset rendered files and start filling viewport again
        renderedFiles = [];
        visibleNotes.clear();
        filteredFiles = fileManager.getFilteredFiles();
        hasMore = filteredFiles.length > 0;
        firstLoaded = true;
        startFillViewport();
    }

    onMount(() => {
        fileManager = new FileManager(fileManagerOptions);
        filteredFiles = fileManager.getFilteredFiles();
        hasMore = filteredFiles.length > 0;
        startFillViewport();
    });

    export function refresh() {
        if (!fileManager) return;
        fileManager.forceRefresh();
        renderedFiles = [];
        visibleNotes.clear();
        filteredFiles = fileManager.getFilteredFiles();
        hasMore = filteredFiles.length > 0;
        firstLoaded = true;
        startFillViewport();
    }

    export function foldAll() {
        collapseAll = true;
    }

    export function expandAll() {
        collapseAll = false;
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
        const endIndex = Math.min(startIndex + 10, filteredFiles.length);
        renderedFiles = [...renderedFiles, ...filteredFiles.slice(startIndex, endIndex)];
        if (endIndex >= filteredFiles.length) {
            hasMore = false;
        }
    }

    function stopFillViewport() {
        // no-op: managed by inview directives
    }

    function infiniteHandler(e: CustomEvent<{ inView: boolean }>) {
        if (e.detail.inView && hasMore) {
            fillViewport();
        }
    }

    export function fileCreate(file: TFile) {
        fileManager.fileCreate(file);
        
        // For folder and tag modes, update the rendered files
        const updatedFiles = fileManager.getFilteredFiles();
        if (updatedFiles.some(f => f.path === file.path) && 
            !renderedFiles.some(f => f.path === file.path)) {
            renderedFiles = [file, ...renderedFiles];
            visibleNotes.add(file.path);
            visibleNotes = visibleNotes;
        }
    }

    export function fileDelete(file: TFile) {
        fileManager.fileDelete(file);
        
        renderedFiles = renderedFiles.filter((f) => {
            return f.path !== file.path;
        });
        
        if (visibleNotes.has(file.path)) {
            visibleNotes.delete(file.path);
            visibleNotes = visibleNotes;
        }
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
            />
        </div>
    {/each}
    <div bind:this={loaderRef} class="kw-view-loader" use:inview={{
        root: leaf.view.containerEl
    }} on:inview_init={startFillViewport} on:inview_change={infiniteHandler}
         on:inview_leave={stopFillViewport}/>
    {#if !hasMore}
        <div class="no-more-text">—— No more results ——</div>
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
        margin-left: auto;
        margin-right: auto;
        text-align: center;
    }
    
    .keyword-note-wrapper {
        width: 100%;
    }
</style>
