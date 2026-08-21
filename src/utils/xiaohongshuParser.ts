import { App, TFile } from "obsidian";

/**
 * 小红书卡片解析（只服务于排版，不涉及编辑）
 *
 * 切图规则沿用 `notepub/src/cards/paginate.js`：
 * - 先剥 frontmatter，再逐行扫描并跳过围栏代码块。
 * - 全文存在 H2 时按 H2 切，否则按 H1 切（H1 fallback）。
 * - 每个 section 内部用 `---`（thematic break：3 个及以上 `-` / `*` / `_`）
 *   再切 chunk；空 chunk 丢弃；1 个 chunk 直接是原文，K 个 `---` 拆 K+1 张卡。
 * - 标题前的内容不生成卡片。
 *
 * 每张卡包含：
 * - `cardTitle`：section 标题
 * - `body`：section markdown（图片保留在原位置，仅去掉 `---` 切图线）
 * - `tags`：frontmatter tags + inline tags 合并去重
 * - `noteTitle`：所属笔记标题（用于页脚）
 */

export const MAX_TAGS = 4;

export interface XiaohongshuCard {
    /** 所属笔记的标题（用于卡片页脚标识） */
    noteTitle: string;
    /** section 标题 */
    cardTitle: string;
    /** section markdown（图片保留在原位置，不含切图线） */
    body: string;
    /** 展示用标签（含 # 前缀） */
    tags: string[];
    /** 该卡是笔记中的第几张（0 开始） */
    cardIndex: number;
    /** 该笔记的卡片总数 */
    total: number;
}

interface ScannedLine {
    line: string;
    inFence: boolean;
}

interface Section {
    heading: string;
    content: ScannedLine[];
}

// ── 切图核心（移植自 notepub paginate.js） ──────────────────────────────

function scanLines(source: string): ScannedLine[] {
    const scanned: ScannedLine[] = [];
    let fence: string | null = null;

    for (const line of source.split(/\r?\n/)) {
        const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
        const inFence = Boolean(fence);
        scanned.push({ line, inFence: inFence || Boolean(fenceMatch) });

        if (!fenceMatch) continue;
        const marker = fenceMatch[1];
        if (!fence) {
            fence = marker;
        } else if (marker[0] === fence[0] && marker.length >= fence.length) {
            fence = null;
        }
    }
    return scanned;
}

function headingText(line: string, level: number): string {
    const match = line.match(new RegExp(`^ {0,3}#{${level}}[ \\t]+(.+?)\\s*$`));
    return match?.[1].replace(/[ \t]+#+[ \t]*$/, "").trim() ?? "";
}

function isThematicBreak(line: string): boolean {
    const compact = line.trim().replace(/[ \t]/g, "");
    return /^(?:-{3,}|\*{3,}|_{3,})$/.test(compact);
}

/** 切出 section 列表：H2 优先，H1 fallback，标题前内容不生成卡片。 */
function paginateSections(source: string): Section[] {
    const scanned = scanLines(source);
    const hasH2 = scanned.some((e) => !e.inFence && headingText(e.line, 2));
    const level = hasH2 ? 2 : 1;

    const sections: Section[] = [];
    let current: Section | null = null;

    for (const entry of scanned) {
        const heading = !entry.inFence && headingText(entry.line, level);
        if (heading) {
            current = { heading, content: [] };
            sections.push(current);
        } else if (current) {
            current.content.push(entry);
        }
    }

    return sections;
}

/** section → 一个或多个 chunk（按 `---` 切），空 chunk 丢弃。 */
function sectionToChunks(section: Section): string[] {
    const chunks: string[][] = [[]];
    for (const entry of section.content) {
        if (!entry.inFence && isThematicBreak(entry.line)) {
            chunks.push([]);
        } else {
            chunks[chunks.length - 1].push(entry.line);
        }
    }
    if (chunks.length === 1) {
        return [chunks[0].join("\n").trim()];
    }

    return chunks
        .map((lines) => lines.join("\n").trim())
        .filter((md) => md.length > 0);
}

// ── frontmatter / 标签 ─────────────────────────────────────────────────

function findContentStart(app: App, file: TFile, source: string): number {
    const cachedEnd = app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset;
    if (typeof cachedEnd === "number" && cachedEnd > 0 && cachedEnd <= source.length) {
        const newline = source.indexOf("\n", cachedEnd);
        return newline === -1 ? cachedEnd : newline + 1;
    }

    const match = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(source);
    if (match) return match[0].length;

    return source.startsWith("\uFEFF") ? 1 : 0;
}

function collectInlineTags(source: string, contentStart: number): string[] {
    const tags = new Set<string>();
    const linePattern = /^(.*)$/gm;
    const tagPattern = /(?:^|\s)#([A-Za-z0-9_\-\/]+)/g;
    const fencePattern = /^[ \t]{0,3}(`{3,}|~{3,})/;
    let fenceChar: string | null = null;
    let match: RegExpExecArray | null;

    while ((match = linePattern.exec(source)) !== null) {
        const text = match[1];
        if (match[0].length === 0) linePattern.lastIndex += 1;

        const fence = fencePattern.exec(text);
        if (fence) {
            const char = fence[1].charAt(0);
            if (fenceChar === null) fenceChar = char;
            else if (fenceChar === char) fenceChar = null;
            continue;
        }
        if (fenceChar !== null) continue;
        if (match.index < contentStart) continue;

        tagPattern.lastIndex = 0;
        let tagMatch: RegExpExecArray | null;
        while ((tagMatch = tagPattern.exec(text)) !== null) {
            tags.add(`#${tagMatch[1]}`);
        }
    }

    return [...tags];
}

// ── 公开 API ──────────────────────────────────────────────────────────

export async function parseXiaohongshuCards(app: App, file: TFile): Promise<XiaohongshuCard[]> {
    const source = await app.vault.cachedRead(file);
    const contentStart = findContentStart(app, file, source);
    const bodySource = source.slice(contentStart);

    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter ?? {}) as { title?: unknown; tags?: unknown };

    const noteTitle =
        typeof frontmatter.title === "string" && frontmatter.title.trim()
            ? frontmatter.title.trim()
            : file.basename;

    // 标签只从整篇笔记取一次
    const tagSet = new Set<string>();
    if (Array.isArray(frontmatter.tags)) {
        for (const tag of frontmatter.tags) {
            if (typeof tag === "string" && tag.trim()) {
                tagSet.add(tag.trim().startsWith("#") ? tag.trim() : `#${tag.trim()}`);
            }
        }
    } else if (typeof frontmatter.tags === "string" && frontmatter.tags.trim()) {
        for (const part of frontmatter.tags.split(/[,\s]+/)) {
            if (part) tagSet.add(part.startsWith("#") ? part : `#${part}`);
        }
    }
    for (const tag of collectInlineTags(source, contentStart)) {
        tagSet.add(tag);
    }
    const tags = [...tagSet].slice(0, MAX_TAGS);

    // 切 section，再切 chunk
    const sections = paginateSections(bodySource);
    if (sections.length === 0) return [];

    const sectionChunks = sections.map(sectionToChunks);
    const total = sectionChunks.reduce((sum, chunks) => sum + chunks.length, 0);
    const cards: XiaohongshuCard[] = [];
    let cardIndex = 0;

    sections.forEach((section, sectionIdx) => {
        const chunks = sectionChunks[sectionIdx];
        // section 没有可渲染的 chunk（整段被 `---` 切到只剩空行），跳过
        if (chunks.length === 0) return;

        const cardTitle = section.heading;

        chunks.forEach((chunkLines) => {
            cards.push({
                noteTitle,
                cardTitle,
                body: trimBlankEdges(chunkLines),
                tags,
                cardIndex,
                total,
            });
            cardIndex++;
        });
    });

    return cards;
}

function trimBlankEdges(text: string): string {
    return text.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
}
