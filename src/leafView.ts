// Original code from https://github.com/nothingislost/obsidian-hover-editor/blob/9ec3449be9ab3433dc46c4c3acfde1da72ff0261/src/popover.ts
// You can use this file as a basic leaf view create method in anywhere
// Please rememeber if you want to use this file, you should patch the obsidian.d.ts file
// And also monkey around the Obsidian original method.
import {
    Component,
    EphemeralState,
    HoverPopover,
    OpenViewState,
    parseLinktext,
    PopoverState,
    requireApiVersion,
    resolveSubpath,
    TFile,
    View,
    Workspace,
    WorkspaceItem,
    WorkspaceLeaf,
    WorkspaceSplit,
    WorkspaceTabs,
} from "obsidian";

import type KeywordNotesPlugin from "./keywordNotesPlugin";
import { genId } from "./utils/utils";


export interface KeywordNoteEditorParent {
    hoverPopover: KeywordNoteEditor | null;
    KeywordNoteEditor?: KeywordNoteEditor | null;
    containerEl?: HTMLElement;
    editorEl?: HTMLElement;
    view?: View;
    dom?: HTMLElement;
}

const popovers = new WeakMap<Element, KeywordNoteEditor>();
type ConstructableWorkspaceSplit = new (ws: Workspace, dir: "horizontal" | "vertical") => WorkspaceSplit;
type WorkspaceLeafWithNullableParent = WorkspaceLeaf & { parent?: WorkspaceItem | null };
type WorkspaceSplitWithNullableChildren = WorkspaceSplit & { children?: WorkspaceItem[] | null };
type WorkspaceParentWithChildren = WorkspaceSplit & { children?: WorkspaceItem[] | null };
type KeywordNoteWorkspaceLeaf = WorkspaceLeaf & { __keywordNoteEmbedded?: boolean };
type ConstructableWithPrototype<T> = { new (...args: never[]): T; prototype: object };

export function isKeywordNoteLeaf(leaf: WorkspaceLeaf) {
    if ((leaf as KeywordNoteWorkspaceLeaf).__keywordNoteEmbedded) return true;
    return leaf.containerEl.matches(".kw-editor.kw-leaf-view .workspace-leaf");
}

function isLeafAttached(leaf: WorkspaceLeaf): boolean {
    return Boolean((leaf as WorkspaceLeafWithNullableParent).parent);
}

function nosuper<T>(base: ConstructableWithPrototype<T>): new () => T {
    const derived = function () {
        const target = new.target as unknown as { prototype: object };
        const component = new Component() as unknown as T;
        Object.setPrototypeOf(component, target.prototype);
        return component;
    } as unknown as new () => T;
    (derived as { prototype: object }).prototype = base.prototype;
    Object.setPrototypeOf(derived, base);
    return derived;
}

export const spawnLeafView = (plugin: KeywordNotesPlugin, initiatingEl?: HTMLElement, leaf?: WorkspaceLeaf, onShowCallback?: () => unknown): [WorkspaceLeaf, KeywordNoteEditor] => {
    // Keep embedded keyword editors parented to the keyword view leaf that created them.
    // Using the most recent leaf can accidentally bind them to another plugin view.
    let parent = leaf as unknown as KeywordNoteEditorParent;
    if (!parent) parent = plugin.app.workspace.getMostRecentLeaf() as unknown as KeywordNoteEditorParent;

    if (!initiatingEl) initiatingEl = parent?.containerEl;

    const hoverPopover = new KeywordNoteEditor(parent, initiatingEl!, plugin, undefined, onShowCallback);
    return [hoverPopover.attachLeaf(), hoverPopover];

};

export class KeywordNoteEditor extends nosuper(HoverPopover) {
    parent: KeywordNoteEditorParent | null;
    onTarget: boolean;
    setActive: (event: MouseEvent) => void;

    lockedOut = false;
    abortController? = this.addChild(new Component());
    detaching = false;
    detachScheduled = false;
    opening = false;

    rootSplit: WorkspaceSplit;
    isPinned = true;

    titleEl!: HTMLElement;
    containerEl!: HTMLElement;

    // It is currently not useful.
    // leafInHoverEl: WorkspaceLeaf;

    oldPopover: KeywordNoteEditor | null = null;
    ownerDocument: Document;

    id = genId(8);
    bounce?: NodeJS.Timeout;
    boundOnZoomOut: () => void = () => undefined;

    originalPath = ""; // these are kept to avoid adopting targets w/a different link
    originalLinkText = "";
    static activePopover?: KeywordNoteEditor;

    static activeWindows(ws: Workspace) {
        const windows: Window[] = [window];
        const floatingSplit = ws?.floatingSplit;
        if (floatingSplit) {
            for (const split of floatingSplit.children) {
                if (split.win) windows.push(split.win);
            }
        }
        return windows;
    }

    static containerForDocument(plugin: KeywordNotesPlugin, doc: Document) {
        if (doc !== activeDocument && plugin.app.workspace.floatingSplit)
            for (const container of plugin.app.workspace.floatingSplit.children) {
                if (container.doc === doc) return container;
            }
        return plugin.app.workspace.rootSplit;
    }

    static activePopovers(ws: Workspace) {
        return this.activeWindows(ws).flatMap((win) => this.popoversForWindow(win));
    }

    static popoversForWindow(win?: Window) {
        const body = (win ?? window).activeDocument.body;
        return Array.from(body.querySelectorAll<HTMLElement>(".kw-leaf-view"))
            .map(el => popovers.get(el)!)
            .filter(he => he);
    }

    static forLeaf(leaf: WorkspaceLeaf | undefined) {
        // leaf can be null such as when right clicking on an internal link
        const el = leaf?.containerEl.closest<HTMLElement>(".kw-leaf-view") ?? null;
        return el ? popovers.get(el) : undefined;
    }

    private static _iteratingPopovers = false;

    static iteratePopoverLeaves(ws: Workspace, cb: (leaf: WorkspaceLeaf) => boolean | void) {
        if (KeywordNoteEditor._iteratingPopovers) return false;
        KeywordNoteEditor._iteratingPopovers = true;
        try {
            for (const popover of this.activePopovers(ws)) {
                if (popover.hasRootChildren() && ws.iterateLeaves(cb, popover.rootSplit)) return true;
            }
        } finally {
            KeywordNoteEditor._iteratingPopovers = false;
        }
        return false;
    }

    declare hoverEl: HTMLElement;

    constructor(
        parent: KeywordNoteEditorParent,
        public targetEl: HTMLElement,
        public plugin: KeywordNotesPlugin,
        waitTime?: number,
        public onShowCallback?: () => unknown,
    ) {
        //
        super();

        if (waitTime === undefined) {
            waitTime = 300;
        }
        this.onTarget = true;

        this.parent = parent;
        this.oldPopover = this.parent?.KeywordNoteEditor ?? null;
        this.waitTime = waitTime;
        this.state = PopoverState.Showing;

        this.rootSplit = new (WorkspaceSplit as ConstructableWorkspaceSplit)(plugin.app.workspace, "vertical");
        this.ownerDocument = this.targetEl?.ownerDocument ?? window.activeDocument ?? activeDocument;
        this.hoverEl = this.ownerDocument.defaultView!.createDiv({
            cls: "kw-editor kw-leaf-view",
            attr: {id: "dn-" + this.id},
        });
        const {hoverEl} = this;

        this.abortController!.load();
        this.timer = window.setTimeout(() => this.show(), waitTime);
        this.setActive = (event) => this._setActive(event);
        if (hoverEl) {
            hoverEl.addEventListener("mousedown", this.setActive);
        }
        // custom logic begin
        popovers.set(this.hoverEl, this);
        this.hoverEl.addClass("kw-editor");
        this.containerEl = this.hoverEl.createDiv("kw-content");
        this.buildWindowControls();
        this.setInitialDimensions();

    }

    _setActive(evt: MouseEvent) {
        evt.preventDefault();
        evt.stopPropagation();
        const leaf = this.leaves()[0];
        if (leaf) {
            this.plugin.app.workspace.setActiveLeaf(leaf, {focus: true});
        }
    }

    getDefaultMode() {
        // return this.parent?.view?.getMode ? this.parent.view.getMode() : "source";
        return "source";
    }

    updateLeaves() {
        if (!this.detaching && this.onTarget && this.targetEl && !this.ownerDocument.contains(this.targetEl)) {
            this.onTarget = false;
            this.transition();
        }
        const leafCount = this.leaves().length;

        if (leafCount === 0) {
            this.hide(); // close if we have no leaves
        }
        this.hoverEl.setAttribute("data-leaf-count", leafCount.toString());
    }

    leaves() {
        const leaves: WorkspaceLeaf[] = [];
        if (!this.hasRootChildren()) return leaves;

        try {
            this.plugin.app.workspace.iterateLeaves(leaf => {
                leaves.push(leaf);
            }, this.rootSplit);
        } catch (error) {
            console.warn("Keyword Notes Editor: failed to iterate embedded leaves", error);
        }
        return leaves;
    }

    hasRootChildren(): boolean {
        const children = (this.rootSplit as WorkspaceSplitWithNullableChildren).children;
        return Array.isArray(children) && children.length > 0;
    }

    setInitialDimensions() {
        this.hoverEl.addClass("kw-editor-default-size");
    }

    transition() {
        if (this.shouldShow()) {
            if (this.state === PopoverState.Hiding) {
                this.state = PopoverState.Shown;
                window.clearTimeout(this.timer);
            }
        } else {
            if (this.state === PopoverState.Showing) {
                this.hide();
            } else {
                if (this.state === PopoverState.Shown) {
                    this.state = PopoverState.Hiding;
                    this.timer = window.setTimeout(() => {
                        if (this.shouldShow()) {
                            this.transition();
                        } else {
                            this.hide();
                        }
                    }, this.waitTime);
                }
            }
        }
    }


    buildWindowControls() {
        this.titleEl = this.ownerDocument.defaultView!.createDiv("popover-titlebar");
        this.titleEl.createDiv("popover-title");

        this.containerEl.prepend(this.titleEl);

    }

    attachLeaf(): WorkspaceLeaf {
        this.rootSplit.getRoot = () => this.plugin.app.workspace[this.ownerDocument === activeDocument ? "rootSplit" : "floatingSplit"];
        this.rootSplit.getContainer = () => KeywordNoteEditor.containerForDocument(this.plugin, this.ownerDocument);

        this.titleEl.insertAdjacentElement("afterend", this.rootSplit.containerEl);
        const leaf = this.plugin.app.workspace.createLeafInParent(this.rootSplit, 0);
        (leaf as KeywordNoteWorkspaceLeaf).__keywordNoteEmbedded = true;

        this.updateLeaves();
        return leaf;
    }

    onload(): void {
        super.onload();
        this.registerEvent(this.plugin.app.workspace.on("layout-change", () => this.updateLeaves()));
        this.registerEvent(this.plugin.app.workspace.on("layout-change", () => {
            // Ensure that top-level items in a popover are not tabbed
            const children = (this.rootSplit as WorkspaceParentWithChildren).children ?? [];
            children.forEach((item, index) => {
                if (item instanceof WorkspaceTabs) {
                    const firstChild = (item as WorkspaceParentWithChildren).children?.[0];
                    if (firstChild) this.rootSplit.replaceChild(index, firstChild);
                }
            });
        }));
    }

    onShow() {
        // Once we've been open for closeDelay, use the closeDelay as a hiding timeout
        const closeDelay = 600;
        window.setTimeout(() => (this.waitTime = closeDelay), closeDelay);

        // Keyword note views intentionally keep many embedded editors open at once.
        // The original hover-popover behavior closes the previous popover here,
        // which can detach the first note after a global collapse/expand cycle.
        this.oldPopover = null;

        this.hoverEl.toggleClass("is-new", true);

        this.ownerDocument.body.addEventListener(
            "click",
            () => {
                this.hoverEl.toggleClass("is-new", false);
            },
            {once: true, capture: true},
        );

        if (this.parent) {
            this.parent.KeywordNoteEditor = this;
        }

        // Remove original view header;
        const viewHeaderEl = this.hoverEl.querySelector(".view-header");
        viewHeaderEl?.remove();

        const sizer = this.hoverEl.querySelector(".workspace-leaf");
        if (sizer) this.hoverEl.appendChild(sizer);

        // Remove original inline tilte;
        const inlineTitle = this.hoverEl.querySelector(".inline-title");
        if (inlineTitle) inlineTitle.remove();

        this.onShowCallback?.();
        this.onShowCallback = undefined; // only call it once
    }

    detect(el: HTMLElement) {
        // TODO: may not be needed? the mouseover/out handers handle most detection use cases
        const {targetEl} = this;

        if (targetEl) {
            this.onTarget = el === targetEl || targetEl.contains(el);
        }
    }

    shouldShow() {
        return this.shouldShowSelf() || this.shouldShowChild();
    }

    shouldShowChild(): boolean {
        return KeywordNoteEditor.activePopovers(this.plugin.app.workspace).some(popover => {
            if (popover !== this && popover.targetEl && this.hoverEl.contains(popover.targetEl)) {
                return popover.shouldShow();
            }
            return false;
        });
    }

    shouldShowSelf() {
        // Don't let obsidian show() us if we've already started closing
        // return !this.detaching && (this.onTarget || this.onHover);
        return (
            !this.detaching &&
            !!(
                this.onTarget ||
                (this.state == PopoverState.Shown) ||
                this.ownerDocument.querySelector(`body>.modal-container, body > #he${this.id} ~ .menu, body > #he${this.id} ~ .suggestion-container`)
            )
        );
    }

    show() {
        // native obsidian logic start
        if (!this.targetEl || this.ownerDocument.body.contains(this.targetEl)) {
            this.state = PopoverState.Shown;
            this.timer = 0;
            this.targetEl.appendChild(this.hoverEl);
            this.onShow();
            this.plugin.app.workspace.onLayoutChange();
            // initializingHoverPopovers.remove(this);
            // activeHoverPopovers.push(this);
            // initializePopoverChecker();
            this.load();
        } else {
            this.hide();
        }
        // native obsidian logic end

        // if this is an image view, set the dimensions to the natural dimensions of the image
        // an interactjs reflow will be triggered to constrain the image to the viewport if it's
        // too large
        if (this.hoverEl.dataset.imgHeight && this.hoverEl.dataset.imgWidth) {
            this.hoverEl.style.height = parseFloat(this.hoverEl.dataset.imgHeight) + this.titleEl.offsetHeight + "px";
            this.hoverEl.style.width = parseFloat(this.hoverEl.dataset.imgWidth) + "px";
        }
    }

    onHide() {
        this.oldPopover = null;
        if (this.parent?.KeywordNoteEditor === this) {
            this.parent.KeywordNoteEditor = null;
        }
    }

    hide() {
        if (this.state === PopoverState.Hidden) return;
        this.onTarget = false;
        this.detaching = true;
        // Once we reach this point, we're committed to closing

        // in case we didn't ever call show()


        // A timer might be pending to call show() for the first time, make sure
        // it doesn't bring us back up after we close
        if (this.timer) {
            window.clearTimeout(this.timer);
            this.timer = 0;
        }

        // Hide our HTML element immediately, even if our leaves might not be
        // detachable yet.  This makes things more responsive and improves the
        // odds of not showing an empty popup that's just going to disappear
        // momentarily.
        this.hoverEl.hide();

        // If a file load is in progress, we need to wait until it's finished before
        // detaching leaves.  Because we set .detaching, The in-progress openFile()
        // will call us again when it finishes.
        if (this.opening) return;

        // Leave this code here to observe the state of the leaves
        const leafToDetach = this.leaves().find(isLeafAttached);
        if (leafToDetach) {
            this.scheduleLeafDetach(leafToDetach);
        } else {
            this.parent = null;
            this.abortController?.unload();
            this.abortController = undefined;
            return this.nativeHide();
        }
    }

    scheduleLeafDetach(leaf: WorkspaceLeaf): void {
        if (this.detachScheduled) return;
        this.detachScheduled = true;

        window.setTimeout(() => {
            try {
                if (isLeafAttached(leaf)) {
                    leaf.detach();
                } else {
                    this.nativeHide();
                }
            } catch (error) {
                console.warn("Keyword Notes Editor: failed to detach embedded leaf", error);
                this.nativeHide();
            }
        }, 50);
    }

    nativeHide() {
        if (this.state === PopoverState.Hidden) return;
        const {hoverEl, targetEl} = this;
        this.state = PopoverState.Hidden;
        hoverEl.detach();

        if (targetEl) {
            const parent = targetEl.matchParent(".kw-leaf-view");
            if (parent) popovers.get(parent)?.transition();
        }

        this.onHide();
        this.unload();
    }

    resolveLink(linkText: string, sourcePath: string): TFile | null {
        const link = parseLinktext(linkText);
        const tFile = link ? this.plugin.app.metadataCache.getFirstLinkpathDest(link.path, sourcePath) : null;
        return tFile;
    }

    async openLink(linkText: string, sourcePath: string, eState?: EphemeralState, createInLeaf?: WorkspaceLeaf) {
        let file = this.resolveLink(linkText, sourcePath);
        const link = parseLinktext(linkText);
        if (!file && createInLeaf) {
            const folder = this.plugin.app.fileManager.getNewFileParent(sourcePath);
            file = await this.plugin.app.fileManager.createNewMarkdownFile(folder, link.path);
        }

        if (!file) {
            // this.displayCreateFileAction(linkText, sourcePath, eState);
            return;
        }
        const {viewRegistry} = this.plugin.app;
        const viewType = viewRegistry.typeByExtension[file.extension];
        if (!viewType || !viewRegistry.viewByType[viewType]) {
            // this.displayOpenFileAction(file);
            return;
        }

        eState = Object.assign(this.buildEphemeralState(file, link), eState);
        const parentMode = this.getDefaultMode();
        const state = this.buildState(parentMode, eState);
        const leaf = await this.openFile(file, state as OpenViewState, createInLeaf);
        const leafViewType = leaf?.view?.getViewType();
        if (leafViewType === "image") {
            // TODO: temporary workaround to prevent image popover from disappearing immediately when using live preview
            if (this.parent?.editorEl?.hasClass("is-live-preview")) {
                this.waitTime = 3000;
            }
            const img = leaf!.view.contentEl.querySelector("img")!;
            this.hoverEl.dataset.imgHeight = String(img.naturalHeight);
            this.hoverEl.dataset.imgWidth = String(img.naturalWidth);
            this.hoverEl.dataset.imgRatio = String(img.naturalWidth / img.naturalHeight);
        } else if (leafViewType === "pdf") {
            this.hoverEl.addClass("kw-editor-pdf-size");
        }
        if (state.state?.mode === "source") {
            this.whenShown(() => {
                // Not sure why this is needed, but without it we get issue #186
                if (requireApiVersion("1.0")) { const v = leaf?.view as unknown as { editMode?: { reinit?: () => void } }; v?.editMode?.reinit?.(); }
                leaf?.view?.setEphemeralState(state.eState);
            });
        }
    }

    whenShown(callback: () => unknown) {
        // invoke callback once the popover is visible
        if (this.detaching) return;
        const existingCallback = this.onShowCallback;
        this.onShowCallback = () => {
            if (this.detaching) return;
            callback();
            if (typeof existingCallback === "function") (existingCallback as () => void)();
        };
        if (this.state === PopoverState.Shown) {
            this.onShowCallback();
            this.onShowCallback = undefined;
        }
    }

    async openFile(file: TFile, openState?: OpenViewState, useLeaf?: WorkspaceLeaf) {
        if (this.detaching) return;
        const leaf = useLeaf ?? this.attachLeaf();
        this.opening = true;

        try {
            await leaf.openFile(file, openState);
        } catch (e) {
            console.error(e);
        } finally {
            this.opening = false;
            if (this.detaching) this.hide();
        }
        this.plugin.app.workspace.setActiveLeaf(leaf);

        return leaf;
    }

    buildState(parentMode: string, eState?: EphemeralState) {
        return {
            active: false, // Don't let Obsidian force focus if we have autofocus off
            state: {mode: "source"}, // Don't set any state for the view, because this leaf is stayed on another view.
            eState: eState,
        };
    }

    buildEphemeralState(
        file: TFile,
        link?: {
            path: string;
            subpath: string;
        },
    ) {
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const subpath = cache ? resolveSubpath(cache, link?.subpath || "") : undefined;
        const eState: EphemeralState = {subpath: link?.subpath};
        if (subpath) {
            eState.line = subpath.start.line;
            eState.startLoc = subpath.start;
            eState.endLoc = subpath.end || undefined;
        }
        return eState;
    }
}
