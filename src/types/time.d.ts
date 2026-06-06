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

export type SelectionMode = "folder" | "tag" | "overview";

export type OverviewTarget = "today" | "recent-edited" | "tasks" | "read-later" | "important-urgent";

export type TimeField =
    | "ctime"
    | "mtime"
    | "ctimeReverse"
    | "mtimeReverse"
    | "name"
    | "nameReverse";
