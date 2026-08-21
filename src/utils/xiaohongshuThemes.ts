export type XiaohongshuThemeId = "light" | "dark" | "warm" | "memo";

export interface XiaohongshuTheme {
    id: XiaohongshuThemeId;
    name: string;
    headerLabel?: string;
    pageBackground: string;
    text: string;
    muted: string;
    title: string;
    accent: string;
    border: string;
    quoteBackground: string;
    quoteText: string;
    codeBackground: string;
    footerBackground: string;
}

export const XIAOHONGSHU_THEMES: XiaohongshuTheme[] = [
    {
        id: "light",
        name: "简约白",
        pageBackground: "#ffffff",
        text: "#333333",
        muted: "#999999",
        title: "#1a1a1a",
        accent: "#d4237a",
        border: "#e8e8e8",
        quoteBackground: "#fdf2f6",
        quoteText: "#666666",
        codeBackground: "#f6f7f9",
        footerBackground: "#ffffff",
    },
    {
        id: "dark",
        name: "深色",
        pageBackground: "#1c1c1e",
        text: "#f2f2f7",
        muted: "#98989d",
        title: "#f2f2f7",
        accent: "#f8c744",
        border: "#38383a",
        quoteBackground: "#2c2c2e",
        quoteText: "#c7c7cc",
        codeBackground: "#2c2c2e",
        footerBackground: "#1c1c1e",
    },
    {
        id: "warm",
        name: "暖橘",
        pageBackground: "#fff8f0",
        text: "#4a3b32",
        muted: "#a77f6d",
        title: "#4a3b32",
        accent: "#e8703a",
        border: "#eadfd3",
        quoteBackground: "#ffeedd",
        quoteText: "#8a7365",
        codeBackground: "#f5ece2",
        footerBackground: "#fff8f0",
    },
    {
        id: "memo",
        name: "备忘录",
        headerLabel: "‹ 备忘录",
        pageBackground: "#fffdf4",
        text: "#2c2c2e",
        muted: "#9b8f60",
        title: "#1c1c1e",
        accent: "#c99a00",
        border: "#e8ddb5",
        quoteBackground: "#fff6cc",
        quoteText: "#5c5540",
        codeBackground: "#f5f0dc",
        footerBackground: "#fffdf4",
    },
];

export function getXiaohongshuTheme(id: XiaohongshuThemeId): XiaohongshuTheme {
    return XIAOHONGSHU_THEMES.find((theme) => theme.id === id) ?? XIAOHONGSHU_THEMES[0];
}

export function isXiaohongshuThemeId(value: string): value is XiaohongshuThemeId {
    return XIAOHONGSHU_THEMES.some((theme) => theme.id === value);
}
