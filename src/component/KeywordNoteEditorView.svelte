<script lang="ts">
    import type KeywordNotesPlugin from "../keywordNotesPlugin";
    import type { WorkspaceLeaf } from "obsidian";

    import { Platform, TFile, setIcon } from "obsidian";
    import KeywordNote from "./KeywordNote.svelte";
    import CornellNote from "./CornellNote.svelte";
    import XiaohongshuCard from "./XiaohongshuCard.svelte";
    import { inview } from "svelte-inview";
    import { SelectionMode, TimeField } from "../types/time";
    import { onDestroy, onMount, tick } from "svelte";
    import { FileManager, FileManagerOptions } from "../utils/fileManager";
    import { XiaohongshuCard as XiaohongshuCardData, parseXiaohongshuCards } from "../utils/xiaohongshuParser";
    import {
        XIAOHONGSHU_THEMES,
        isXiaohongshuThemeId,
        type XiaohongshuThemeId,
    } from "../utils/xiaohongshuThemes";


    export let plugin: KeywordNotesPlugin;
    export let leaf: WorkspaceLeaf;
    export let selectionMode: SelectionMode = "tag";
    export let target: string = "";
    export let timeField: TimeField = "mtime";
    export let includeSubTags: boolean = false;

    // 康奈尔分区显隐（线索 / 正文 / 总结）与线索列宽度
    export let showCue: boolean = true;
    export let showBody: boolean = true;
    export let showSummary: boolean = true;
    export let cornellCueWidth: number = 0;
    export let xiaohongshuTopRightText: string = "";
    export let xiaohongshuBottomLeftText: string = "";

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

    // ── 小红书：一篇笔记一个展示项，展示项内部再按标题 / 分割线翻页 ──
    type XiaohongshuNoteEntry = { file: TFile; cards: XiaohongshuCardData[] };
    let parsedCards = new Map<string, XiaohongshuCardData[]>();
    let parsePromises = new Map<string, Promise<XiaohongshuCardData[]>>();
    let currentNoteIndex = 0;
    let currentPageIndex = 0;
    let activeNotePath = "";
    let xiaohongshuThemeId: XiaohongshuThemeId = plugin.settings.xiaohongshuTheme;

    // Create the file manager
    let fileManager: FileManager;

    $: pinnedScopeKey = plugin.getPinnedScopeKey(selectionMode, target, includeSubTags);
    
    $: fileManagerOptions = {
        mode: selectionMode,
        target: target,
        app: plugin.app,
        timeField: timeField,
        includeSubTags: includeSubTags,
        excludedFolders: (selectionMode === "tag" || selectionMode === "cornell") ? (plugin.settings.excludedFolders || []) : [],
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
            excludedFolders: (selectionMode === "tag" || selectionMode === "cornell") ? (plugin.settings.excludedFolders || []) : [],
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

        // 小红书视图的解析缓存和两级翻页状态也一并重置，
        // 否则用户切走再切回来时，看到的可能是上一个目录的缓存。
        if (isXiaohongshu) {
            parsedCards = new Map();
            parsePromises = new Map();
            currentNoteIndex = 0;
            currentPageIndex = 0;
            activeNotePath = "";
        }

        // Give Svelte a DOM turn to destroy old embedded editor leaves before new notes mount.
        await tick();
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        if (version !== resetVersion) return;

        syncPinnedPaths();
        filteredFiles = getScopedFilteredFiles();
        syncNoteColors();
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
        noteColors = new Map(
            filteredFiles
                .map((file) => [file.path, plugin.getNoteAccentColor(file.path)] as const)
                .filter((entry): entry is readonly [string, string] => entry[1] !== null)
        );
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

        filteredFiles = filteredFiles.filter((f) => f.path !== file.path);
        syncNoteColors();
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
        filteredFiles = getScopedFilteredFiles();
        syncNoteColors();
        
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
        filteredFiles = getScopedFilteredFiles();
        syncNoteColors();
        
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

        const loadedCount = Math.max(renderedFiles.length, 1);
        filteredFiles = getScopedFilteredFiles();
        syncNoteColors();
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

    // ── 康奈尔工具栏 ──
    type CornellZone = "cue" | "body" | "summary";

    const CORNELL_ZONES: Array<{ key: CornellZone; label: string; icon: string; hint: string }> = [
        { key: "cue", label: "线索", icon: "panel-left", hint: "显示/隐藏左侧线索列" },
        { key: "body", label: "正文", icon: "align-left", hint: "隐藏正文即可只看线索做自测" },
        { key: "summary", label: "总结", icon: "text-quote", hint: "显示/隐藏底部总结区" },
    ];

    $: isCornell = selectionMode === "cornell";
    $: isXiaohongshu = selectionMode === "xiaohongshu";
    $: zoneVisibility = { cue: showCue, body: showBody, summary: showSummary } as Record<CornellZone, boolean>;
    $: effectiveCueWidth = cornellCueWidth || plugin.settings.cornellCueWidth || 176;
    $: cornellPreset = !showBody ? "自测模式：只看线索" : !showCue ? "纯阅读：只看正文" : "";

    $: xiaohongshuTitle = (() => {
        // 优先使用 view 上的 folderDisplay（来自侧边栏 entry），否则回退到 target
        const view = leaf?.view as { folderDisplay?: { alias?: string; path?: string } } | undefined;
        const folder = view?.folderDisplay;
        if (folder?.alias) return folder.alias;
        if (folder?.path) return folder.path;
        return target || "";
    })();

    function toggleZone(zone: CornellZone) {
        if (zone === "cue") showCue = !showCue;
        else if (zone === "body") showBody = !showBody;
        else showSummary = !showSummary;

        // Never leave the card with nothing to show.
        if (!showCue && !showBody) {
            if (zone === "cue") showBody = true;
            else showCue = true;
        }

        plugin.settings.cornellShowCue = showCue;
        plugin.settings.cornellShowBody = showBody;
        plugin.settings.cornellShowSummary = showSummary;
        void plugin.saveSettings();
    }

    function toolbarIcon(node: HTMLElement, name: string) {
        setIcon(node, name);
        return {
            update(next: string) {
                node.empty();
                setIcon(node, next);
            },
        };
    }

    function handleNoteVisibilityChange(file: TFile, isVisible: boolean) {
        if (isVisible) {
            visibleNotes.add(file.path);
        } else {
            visibleNotes.delete(file.path);
        }
        visibleNotes = visibleNotes;
    }

    // ── 小红书：异步解析 + 翻页 ──

    function ensureParsed(file: TFile) {
        if (parsedCards.has(file.path) || parsePromises.has(file.path)) return;
        const version = resetVersion;
        const promise = parseXiaohongshuCards(plugin.app, file);
        parsePromises = new Map(parsePromises).set(file.path, promise);
        promise
            .then((cards) => {
                if (version !== resetVersion) return;
                parsedCards = new Map(parsedCards).set(file.path, cards);
            })
            .catch((err) => {
                if (version !== resetVersion) return;
                console.error("Keyword Notes Editor: failed to parse xiaohongshu cards", file.path, err);
                parsedCards = new Map(parsedCards).set(file.path, []);
            })
            .finally(() => {
                if (version !== resetVersion) return;
                const next = new Map(parsePromises);
                next.delete(file.path);
                parsePromises = next;
            });
    }

    /** 每篇已解析笔记只生成一个展示项，内部保留其全部图文页。 */
    function computeNoteEntries(
        files: TFile[],
        cardsByPath: Map<string, XiaohongshuCardData[]>
    ): XiaohongshuNoteEntry[] {
        const out: XiaohongshuNoteEntry[] = [];
        for (const file of files) {
            const cards = cardsByPath.get(file.path);
            if (!cards) continue;
            out.push({ file, cards });
        }
        return out;
    }

    $: noteEntries = computeNoteEntries(filteredFiles, parsedCards);
    $: activeNoteIndex = noteEntries.length === 0 ? 0 : Math.min(currentNoteIndex, noteEntries.length - 1);
    $: activeEntry = noteEntries[activeNoteIndex];
    $: activeCards = activeEntry?.cards ?? [];
    $: activePageIndex = activeCards.length === 0 ? 0 : Math.min(currentPageIndex, activeCards.length - 1);
    $: activeCard = activeCards[activePageIndex];
    $: isParsePending = parsePromises.size > 0;

    $: if ((activeEntry?.file.path ?? "") !== activeNotePath) {
        activeNotePath = activeEntry?.file.path ?? "";
        currentPageIndex = 0;
    }

    // 切到 xiaohongshu 时，把目录里所有笔记一次性丢进解析队列
    $: if (isXiaohongshu) {
        for (const file of filteredFiles) ensureParsed(file);
    }

    // 离开 xiaohongshu 时把两级翻页归零
    $: if (!isXiaohongshu) {
        if (currentNoteIndex !== 0) currentNoteIndex = 0;
        if (currentPageIndex !== 0) currentPageIndex = 0;
    }

    function gotoPrevNote() {
        if (activeNoteIndex > 0) currentNoteIndex = activeNoteIndex - 1;
    }

    function gotoNextNote() {
        if (activeNoteIndex < noteEntries.length - 1) currentNoteIndex = activeNoteIndex + 1;
    }

    function gotoPrevPage() {
        if (activePageIndex > 0) currentPageIndex = activePageIndex - 1;
    }

    function gotoNextPage() {
        if (activePageIndex < activeCards.length - 1) currentPageIndex = activePageIndex + 1;
    }

    function changeXiaohongshuTheme(event: Event) {
        const value = (event.currentTarget as HTMLSelectElement).value;
        if (!isXiaohongshuThemeId(value)) return;
        xiaohongshuThemeId = value;
        plugin.settings.xiaohongshuTheme = value;
        void plugin.saveSettings();
    }

    function openActiveInMain() {
        if (!activeEntry) return;
        void plugin.app.workspace.openLinkText(activeEntry.file.path, activeEntry.file.path, false);
    }

    function handleWindowKey(event: KeyboardEvent) {
        if (!isXiaohongshu) return;
        const target = event.target;
        if (target instanceof HTMLElement) {
            if (target.matches("input, textarea, [contenteditable]")) return;
            if (target.closest(".cm-editor")) return;
        }
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            gotoPrevNote();
        } else if (event.key === "ArrowRight") {
            event.preventDefault();
            gotoNextNote();
        } else if (event.key === "Home") {
            event.preventDefault();
            currentNoteIndex = 0;
        } else if (event.key === "End") {
            event.preventDefault();
            currentNoteIndex = Math.max(0, noteEntries.length - 1);
        }
    }

    onMount(() => {
        window.addEventListener("keydown", handleWindowKey);
    });

    onDestroy(() => {
        window.removeEventListener("keydown", handleWindowKey);
    });

</script>

<div class="keyword-note-view" class:is-cornell={isCornell} class:is-xiaohongshu={isXiaohongshu}>
    {#if isCornell}
        <div class="kw-cornell-toolbar">
            <div class="kw-cornell-segment" role="group" aria-label="康奈尔分区显示">
                {#each CORNELL_ZONES as zone (zone.key)}
                    <button
                        type="button"
                        class="kw-cornell-segment-btn"
                        class:is-active={zoneVisibility[zone.key]}
                        aria-pressed={zoneVisibility[zone.key]}
                        title={zone.hint}
                        on:click={() => toggleZone(zone.key)}
                    >
                        <span class="kw-cornell-segment-icon" use:toolbarIcon={zone.icon}></span>
                        <span>{zone.label}</span>
                    </button>
                {/each}
            </div>
            <div class="kw-cornell-toolbar-spacer"></div>
            {#if cornellPreset}
                <span class="kw-cornell-toolbar-note">{cornellPreset}</span>
            {/if}
        </div>
    {/if}
    {#if isXiaohongshu}
        <!-- 小红书：顶部切换笔记，单篇笔记内部切换图文页 -->
        <div class="kw-xhs-toolbar">
            <span class="kw-xhs-toolbar-title">🌸 {xiaohongshuTitle}</span>
            <span class="kw-xhs-toolbar-spacer"></span>
            <select
                class="kw-xhs-theme-select"
                aria-label="图文主题"
                title="图文主题"
                value={xiaohongshuThemeId}
                on:change={changeXiaohongshuTheme}
            >
                {#each XIAOHONGSHU_THEMES as theme (theme.id)}
                    <option value={theme.id}>{theme.name}</option>
                {/each}
            </select>
            <button
                type="button"
                class="kw-xhs-nav-btn"
                title="上一篇笔记 (←)"
                aria-label="上一篇笔记"
                on:click={gotoPrevNote}
                disabled={activeNoteIndex <= 0}
            >
                <span class="kw-xhs-nav-icon" use:toolbarIcon={"arrow-left"}></span>
            </button>
            <span class="kw-xhs-indicator" aria-live="polite">
                {noteEntries.length === 0 ? "0 / 0" : `${activeNoteIndex + 1} / ${noteEntries.length}`}
            </span>
            <button
                type="button"
                class="kw-xhs-nav-btn"
                title="下一篇笔记 (→)"
                aria-label="下一篇笔记"
                on:click={gotoNextNote}
                disabled={activeNoteIndex >= noteEntries.length - 1}
            >
                <span class="kw-xhs-nav-icon" use:toolbarIcon={"arrow-right"}></span>
            </button>
            <button
                type="button"
                class="kw-xhs-open-btn"
                title="在主区打开当前笔记"
                aria-label="在主区打开当前笔记"
                on:click={openActiveInMain}
                disabled={!activeEntry}
            >
                <span class="kw-xhs-nav-icon" use:toolbarIcon={"external-link"}></span>
                <span>在主区打开</span>
            </button>
        </div>

        {#if noteEntries.length === 0}
            <div class="kw-xhs-empty">
                {isParsePending ? "正在切分笔记…" : "该目录下没有可显示的笔记"}
            </div>
        {:else if activeEntry}
            <div class="kw-xhs-stage-head">
                <span class="kw-xhs-stage-head-title">{activeEntry.file.basename}</span>
                {#if activeCard}
                    <div class="kw-xhs-page-nav" aria-label="图文页导航">
                        <button
                            type="button"
                            class="kw-xhs-nav-btn"
                            title="上一张图文页"
                            aria-label="上一张图文页"
                            on:click={gotoPrevPage}
                            disabled={activePageIndex <= 0}
                        >
                            <span class="kw-xhs-nav-icon" use:toolbarIcon={"chevron-left"}></span>
                        </button>
                        <span class="kw-xhs-stage-head-meta">
                            {activeCard.cardTitle} · {activePageIndex + 1} / {activeCards.length}
                        </span>
                        <button
                            type="button"
                            class="kw-xhs-nav-btn"
                            title="下一张图文页"
                            aria-label="下一张图文页"
                            on:click={gotoNextPage}
                            disabled={activePageIndex >= activeCards.length - 1}
                        >
                            <span class="kw-xhs-nav-icon" use:toolbarIcon={"chevron-right"}></span>
                        </button>
                    </div>
                {/if}
            </div>
            {#if activeCard}
                <div class="kw-xhs-stage">
                    <XiaohongshuCard
                        file={activeEntry.file}
                        card={activeCard}
                        plugin={plugin}
                        themeId={xiaohongshuThemeId}
                        topRightText={xiaohongshuTopRightText}
                        bottomLeftText={xiaohongshuBottomLeftText}
                        noteColor={noteColors.get(activeEntry.file.path) ?? null}
                        openOnClick={true}
                    />
                </div>
            {:else}
                <div class="kw-xhs-empty">
                    这篇笔记没有可生成的图文页。请用 ## 标题分段，或在没有 ## 时使用 # 标题。
                </div>
            {/if}
            {#if activeCard && activeCard.tags.length > 0}
                <div class="kw-xhs-stage-tags">
                    {#each activeCard.tags as tag (tag)}
                        <span class="kw-xhs-stage-tag">{tag}</span>
                    {/each}
                </div>
            {/if}
        {/if}
    {:else}
        <!-- 其它模式：列表 + 无限滚动 -->
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
                {#if isCornell}
                    <!-- 展示态是康奈尔布局，双击后原样渲染下面这张关键词卡片 -->
                    <CornellNote
                        file={file}
                        plugin={plugin}
                        leaf={leaf}
                        {showCue}
                        {showBody}
                        {showSummary}
                        cueWidth={effectiveCueWidth}
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
                {:else}
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
                {/if}
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
    {/if}
</div>


<style>
    /* ── 康奈尔工具栏：分段式图标开关，跟随内容区滚动吸顶 ── */
    .keyword-note-view.is-cornell {
        gap: var(--size-4-3);
    }

    /* ── 小红书：笔记与图文页两级导航 ── */
    .keyword-note-view.is-xiaohongshu {
        gap: var(--size-4-3);
    }

    .kw-xhs-toolbar {
        position: sticky;
        top: 0;
        z-index: 5;
        display: flex;
        align-items: center;
        gap: var(--size-4-2);
        padding: var(--size-2-2) 0 var(--size-2-3);
        background: var(--background-primary);
    }

    .kw-xhs-toolbar-title {
        font-size: var(--font-ui-medium);
        font-weight: 600;
        color: var(--text-normal);
        max-width: 40%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .kw-xhs-toolbar-spacer {
        flex: 1;
    }

    .kw-xhs-theme-select {
        width: auto;
        min-width: 88px;
        height: 28px;
        padding: 0 var(--size-4-2);
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--background-primary);
        color: var(--text-muted);
        font-size: var(--font-ui-small);
    }

    .kw-xhs-nav-btn,
    .kw-xhs-open-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--size-2-2);
        height: 28px;
        padding: 0 var(--size-4-2);
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--background-primary);
        box-shadow: none;
        color: var(--text-muted);
        font-size: var(--font-ui-small);
        cursor: pointer;
        transition: background-color 0.14s ease, color 0.14s ease, border-color 0.14s ease;
    }

    .kw-xhs-nav-btn {
        padding: 0;
        width: 32px;
        justify-content: center;
    }

    .kw-xhs-nav-btn:hover:not(:disabled),
    .kw-xhs-open-btn:hover:not(:disabled) {
        color: var(--text-normal);
        background: var(--background-modifier-hover);
        border-color: var(--background-modifier-border-hover);
    }

    .kw-xhs-nav-btn:disabled,
    .kw-xhs-open-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .kw-xhs-nav-icon {
        display: inline-flex;
        align-items: center;
    }

    .kw-xhs-nav-icon :global(svg) {
        width: 16px;
        height: 16px;
    }

    .kw-xhs-indicator {
        min-width: 64px;
        text-align: center;
        font-variant-numeric: tabular-nums;
        font-size: var(--font-ui-small);
        color: var(--text-muted);
    }

    .kw-xhs-empty {
        padding: var(--size-4-8) var(--size-4-4);
        text-align: center;
        color: var(--text-muted);
        font-size: var(--font-ui-small);
        line-height: 1.7;
    }

    .kw-xhs-stage-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--size-4-3);
        padding: 0 var(--size-4-2) var(--size-2-2);
    }

    .kw-xhs-stage-head-title {
        font-size: var(--inline-title-size, 1.5em);
        font-weight: var(--inline-title-weight, 700);
        line-height: 1.3;
        color: var(--text-normal);
    }

    .kw-xhs-stage-head-meta {
        font-size: var(--font-ui-small);
        color: var(--text-faint);
    }

    .kw-xhs-page-nav {
        display: flex;
        align-items: center;
        gap: var(--size-4-2);
    }

    .kw-xhs-stage {
        display: flex;
        justify-content: center;
        padding: 0 var(--size-4-3) var(--size-4-3);
    }

    .kw-xhs-stage-tags {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 4px;
        padding: 0 var(--size-4-3) var(--size-4-6);
    }

    .kw-xhs-stage-tag {
        font-size: 11px;
        line-height: 1.4;
        padding: 1px 8px;
        border-radius: 999px;
        color: var(--text-muted);
        background: var(--background-modifier-hover);
    }

    .kw-cornell-toolbar {
        position: sticky;
        top: 0;
        z-index: 5;
        display: flex;
        align-items: center;
        gap: var(--size-4-2);
        padding: var(--size-2-2) 0 var(--size-2-3);
        background: var(--background-primary);
    }

    .kw-cornell-segment {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 2px;
        border-radius: 8px;
        background: var(--background-modifier-hover);
    }

    .kw-cornell-segment-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--size-2-2);
        height: 26px;
        padding: 0 var(--size-4-2);
        border: none;
        border-radius: 6px;
        background: transparent;
        box-shadow: none;
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
        cursor: pointer;
        transition: background-color 0.14s ease, color 0.14s ease;
    }

    .kw-cornell-segment-btn:hover {
        color: var(--text-normal);
    }

    .kw-cornell-segment-btn.is-active {
        background: var(--background-primary);
        color: var(--text-normal);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
    }

    .kw-cornell-segment-icon {
        display: inline-flex;
        align-items: center;
    }

    .kw-cornell-segment-icon :global(svg) {
        width: 14px;
        height: 14px;
    }

    .kw-cornell-toolbar-spacer {
        flex: 1;
    }

    .kw-cornell-toolbar-note {
        font-size: var(--font-ui-smaller);
        color: var(--text-faint);
    }

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
