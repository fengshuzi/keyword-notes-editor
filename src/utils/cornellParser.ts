import { App, TFile } from "obsidian";

/**
 * 康奈尔结构解析（只服务于排版，不涉及编辑）
 *
 * 约定：
 * - `##` 标题 = 线索，标题下面到下一个 `##` 之间 = 正文。
 * - **最后一个 `##` 分区直接就是总结**，不看标题文字叫什么（只有一个 `##` 时不拆，
 *   否则正文会被掏空）。
 * - 第一个 `##` 之前的内容归入正文开头，不会被藏起来。
 * - frontmatter 不参与显示。
 *
 * 展示态把所有线索聚合成一张卡、所有正文聚合成一张卡、总结单独一张卡，
 * 所以这里只需要文本，不需要任何原文偏移量。
 */

export interface CornellSection {
    /** 线索文字（`##` 标题）。第一个 `##` 之前的分区为空字符串 */
    cue: string;
    /** 正文 markdown，不含标题行 */
    body: string;
}

export interface CornellDocument {
    /** 第一个 `##` 之前的内容，没有则为 null */
    topic: CornellSection | null;
    /** 线索 / 正文分区，按文档顺序，不含总结 */
    rows: CornellSection[];
    /** 最后一个 `##` 分区；只有一个 `##` 时为 null */
    summary: CornellSection | null;
    /** 是否存在 `##` 标题 */
    hasCues: boolean;
    /** 除 frontmatter 外是否为空 */
    isEmpty: boolean;
}

interface RawHeading {
    /** `##` 行起始偏移量 */
    start: number;
    /** 标题行之后的偏移量 */
    afterLine: number;
    cue: string;
}

export async function parseCornellDocument(app: App, file: TFile): Promise<CornellDocument> {
    const source = await app.vault.cachedRead(file);
    const contentStart = findContentStart(app, file, source);
    const headings = collectHeadings(app, file, source, contentStart);

    const firstHeadingStart = headings.length > 0 ? headings[0].start : source.length;
    const topicBody = trimBlankEdges(source.slice(contentStart, firstHeadingStart));
    const topic: CornellSection | null = topicBody ? { cue: "", body: topicBody } : null;

    const sections: CornellSection[] = headings.map((heading, index) => {
        const end = index + 1 < headings.length ? headings[index + 1].start : source.length;
        return {
            cue: heading.cue,
            body: trimBlankEdges(source.slice(heading.afterLine, end)),
        };
    });

    const summary = sections.length >= 2 ? sections.pop() ?? null : null;

    return {
        topic,
        rows: sections,
        summary,
        hasCues: headings.length > 0,
        isEmpty: source.slice(contentStart).trim().length === 0,
    };
}

/** 内容起点，跳过 frontmatter */
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

function collectHeadings(app: App, file: TFile, source: string, contentStart: number): RawHeading[] {
    const fromCache = collectFromMetadataCache(app, file, source, contentStart);
    if (fromCache.length > 0) return fromCache;
    return collectFromRegex(source, contentStart);
}

function collectFromMetadataCache(app: App, file: TFile, source: string, contentStart: number): RawHeading[] {
    const headings = app.metadataCache.getFileCache(file)?.headings;
    if (!headings || headings.length === 0) return [];

    return headings
        .filter((heading) => heading.level === 2 && heading.position.start.offset >= contentStart)
        .map((heading) => toRawHeading(heading.heading, heading.position.start.offset, source));
}

/**
 * 缓存兜底路径：逐行扫描，跳过围栏代码块。
 * 正文里演示 Markdown 语法时，代码块内部常有 `## xxx`，不能当成线索。
 */
function collectFromRegex(source: string, contentStart: number): RawHeading[] {
    const result: RawHeading[] = [];
    const linePattern = /^(.*)$/gm;
    const headingPattern = /^##[ \t]+(.+?)[ \t]*#*[ \t]*$/;
    const fencePattern = /^[ \t]{0,3}(`{3,}|~{3,})/;
    let fenceChar: string | null = null;
    let match: RegExpExecArray | null;

    while ((match = linePattern.exec(source)) !== null) {
        const text = match[1];
        // 零宽匹配（空行）会让 lastIndex 卡住，手动推进
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

        const heading = headingPattern.exec(text);
        if (heading) result.push(toRawHeading(heading[1], match.index, source));
    }

    return result;
}

function toRawHeading(cue: string, start: number, source: string): RawHeading {
    const lineEnd = source.indexOf("\n", start);
    return {
        cue: cue.trim(),
        start,
        afterLine: lineEnd === -1 ? source.length : lineEnd + 1,
    };
}

/** 去掉首尾空行，中间格式原样保留 */
function trimBlankEdges(text: string): string {
    return text.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
}
