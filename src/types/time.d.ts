export type TimeRange =
    | "week"
    | "month"
    | "year"
    | "all"
    | "last-week"
    | "last-month"
    | "last-year"
    | "quarter"
    | "last-quarter"
    | "custom";

export type SelectionMode = "folder" | "tag" | "overview" | "cornell" | "xiaohongshu";

export type OverviewTarget = "today" | "todo" | "read-later" | "important-urgent" | `recent:${string}`;

export type TimeField =
    | "ctime"
    | "mtime"
    | "ctimeReverse"
    | "mtimeReverse"
    | "name"
    | "nameReverse";
