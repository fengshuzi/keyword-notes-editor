export interface LineKeywordEntry<TFile> {
    file: TFile;
    lines: string[];
}

const LIST_LINE_RE = /^\s{0,3}-\s+/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const INLINE_CODE_RE = /`[^`\n]*`/g;
const TAG_RE = /(?<![\w/#\\])#([\w\-/\u00c0-\u024f\u0400-\u04ff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]+)/g;

export function parseLineKeywords(value: string): string[] {
    return [...new Set(
        value
            .split(/[+,]/)
            .map((item) => item.trim().replace(/^#/, "").toLowerCase())
            .filter(Boolean)
    )];
}

export function extractLineKeywordLines(content: string, value: string): string[] {
    const keywords = parseLineKeywords(value);
    if (keywords.length === 0) return [];

    const matches: string[] = [];
    let fence = "";
    for (const line of content.split("\n")) {
        const fenceMatch = FENCE_RE.exec(line);
        if (fenceMatch) {
            const marker = fenceMatch[1];
            if (!fence) fence = marker[0];
            else if (marker[0] === fence) fence = "";
            continue;
        }
        if (fence || !LIST_LINE_RE.test(line)) continue;

        const tags: string[] = [];
        const scan = line.replace(INLINE_CODE_RE, " ");
        TAG_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = TAG_RE.exec(scan)) !== null) {
            const tag = match[1].replace(/[-/]$/, "").toLowerCase();
            if (tag && !/^\d+$/.test(tag)) tags.push(tag);
        }
        if (tags.some((tag) => keywords.some((keyword) => tag === keyword || tag.startsWith(`${keyword}/`)))) {
            matches.push(line.trim());
        }
    }
    return matches;
}
