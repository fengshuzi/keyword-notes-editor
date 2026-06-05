import { TFile, moment, App, getAllTags } from "obsidian";
import type { CachedMetadata, ListItemCache, TagCache } from "obsidian";
import { OverviewTarget, TimeRange, TimeField } from "../types/time";

type BaseTimeField = "ctime" | "mtime" | "name";

export interface FileManagerOptions {
    mode: "folder" | "tag" | "overview";
    target?: string;
    timeRange?: TimeRange;
    customRange?: { start: Date; end: Date } | null;
    app?: App;
    timeField?: TimeField;
    /** 标签模式下是否同时匹配子标签（target/subtag）*/
    includeSubTags?: boolean;
    /** 扫描时排除的文件夹路径列表（如 ["journals"]）*/
    excludedFolders?: string[];
    /** Journal folders used by the Today overview */
    journalFolders?: string[];
}

export class FileManager {
    private allFiles: TFile[] = [];
    private filteredFiles: TFile[] = [];
    private hasFetched: boolean = false;

    // Make options public so it can be accessed from outside
    public options: FileManagerOptions;

    constructor(options: FileManagerOptions) {
        this.options = options;
        this.fetchFiles();
    }

    /**
     * Helper method to parse time field and check if it's reverse
     * @param timeField The time field to parse
     * @returns An object containing isReverse flag and baseTimeField
     */
    private parseTimeField(timeField: TimeField | undefined): {
        isReverse: boolean;
        baseTimeField: BaseTimeField;
    } {
        const field = timeField || "mtime";
        const isReverse = field.endsWith("Reverse");
        const normalized = isReverse ? field.replace("Reverse", "") : field;
        const baseTimeField: BaseTimeField = normalized === "name"
            ? "name"
            : normalized === "ctime"
                ? "ctime"
                : "mtime";
        return { isReverse, baseTimeField };
    }

    /**
     * Helper method to sort files by time field
     * @param files The files to sort
     * @param timeField The time field to sort by
     * @returns Sorted files
     */
    private sortFilesByTimeField(
        files: TFile[],
        timeField?: TimeField
    ): TFile[] {
        const { isReverse, baseTimeField } = this.parseTimeField(timeField);

        return [...files].sort((a, b) => {
            // Handle name-based sorting
            if (baseTimeField === "name") {
                if (isReverse) {
                    return b.name.localeCompare(a.name);
                }
                return a.name.localeCompare(b.name);
            }

            // Handle time-based sorting
            if (isReverse) {
                return a.stat[baseTimeField] - b.stat[baseTimeField];
            }
            return b.stat[baseTimeField] - a.stat[baseTimeField];
        });
    }


    /**
     * Check if a file is inside an excluded folder
     */
    private isExcluded(file: TFile): boolean {
        const excluded = this.options.excludedFolders;
        if (!excluded || excluded.length === 0) return false;
        const folderPath = file.parent?.path || "";
        return excluded.some(folder => {
            const f = folder.trim();
            if (!f) return false;
            return folderPath === f || folderPath.startsWith(f + "/");
        });
    }

    public fetchFiles(): void {
        if (this.hasFetched) return;

        switch (this.options.mode) {
            case "folder":
                this.fetchFolderFiles();
                break;
            case "tag":
                this.fetchTaggedFiles();
                break;
            case "overview":
                this.fetchOverviewFiles();
                break;
        }

        this.hasFetched = true;
        this.filterFilesByRange();
    }

    private fetchFolderFiles(): void {
        if (!this.options.target || !this.options.app) return;

        // Get all files in the vault
        const allFiles = this.options.app.vault.getMarkdownFiles();

        // Filter files by folder path, excluding excluded folders
        this.allFiles = allFiles.filter((file) => {
            if (this.isExcluded(file)) return false;
            const folderPath = file.parent?.path || "";
            return (
                folderPath === this.options.target ||
                folderPath.startsWith(this.options.target + "/")
            );
        });

        // Sort files by the specified time field
        this.allFiles = this.sortFilesByTimeField(
            this.allFiles,
            this.options.timeField
        );
    }

    private fetchTaggedFiles(): void {
        if (!this.options.target || !this.options.app) return;

        // Convert target string to array of lowercase tags with # prefix
        const targetTags = this.options.target
            .split("+")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
            .map((t) => (t.startsWith("#") ? t : "#" + t));

        const includeSubTags = this.options.includeSubTags ?? false;

        const app = this.options.app;
        const allMdFiles = app.vault.getMarkdownFiles();

        for (const file of allMdFiles) {
            const fileCache = app.metadataCache.getFileCache(file);
            if (!fileCache) continue;

            const tags = getAllTags(fileCache) || [];
            const matches = tags.some((tag) => {
                const tagLower = tag.toLowerCase();
                return targetTags.some((targetTag) => {
                    if (includeSubTags) {
                        return tagLower === targetTag || tagLower.startsWith(targetTag + '/');
                    }
                    return tagLower === targetTag;
                });
            });

            if (matches && !this.isExcluded(file)) {
                this.allFiles.push(file);
            }
        }

        // Sort files by the specified time field
        this.allFiles = this.sortFilesByTimeField(
            this.allFiles,
            this.options.timeField
        );
    }

    private fetchOverviewFiles(): void {
        if (!this.options.app) return;

        const target = this.options.target as OverviewTarget | undefined;
        if (target === "today") {
            this.fetchTodayFiles();
        } else if (target === "tasks") {
            this.fetchTaskFiles();
        } else if (target === "read-later") {
            this.fetchReadLaterFiles();
        } else if (target === "important-urgent") {
            this.fetchImportantUrgentFiles();
        }
    }

    private fetchTodayFiles(): void {
        if (!this.options.app) return;

        const journalFiles: TFile[] = [];
        const changedTodayFiles: TFile[] = [];

        for (const file of this.options.app.vault.getMarkdownFiles()) {
            const isJournalToday = this.isJournalFile(file) && this.isTodayJournalFile(file);
            const isChangedToday = this.isTodayTimestamp(file.stat.ctime) || this.isTodayTimestamp(file.stat.mtime);

            if (isJournalToday) {
                journalFiles.push(file);
            } else if (isChangedToday) {
                changedTodayFiles.push(file);
            }
        }

        this.allFiles = [
            ...this.sortFilesByTimeField(journalFiles, this.options.timeField),
            ...this.sortFilesByTimeField(changedTodayFiles, this.options.timeField),
        ];
    }

    private fetchTaskFiles(): void {
        if (!this.options.app) return;

        this.allFiles = this.options.app.vault.getMarkdownFiles().filter((file) => {
            const cache = this.options.app?.metadataCache.getFileCache(file);
            return cache?.listItems?.some(item => item.task === " ") ?? false;
        });

        this.allFiles = this.sortFilesByTimeField(
            this.allFiles,
            this.options.timeField
        );
    }

    private fetchReadLaterFiles(): void {
        if (!this.options.app) return;

        this.allFiles = this.options.app.vault.getMarkdownFiles().filter((file) => {
            const cache = this.options.app?.metadataCache.getFileCache(file);
            return this.hasIncompleteTaskWithTag(cache, "#ril");
        });

        this.allFiles = this.sortFilesByTimeField(
            this.allFiles,
            this.options.timeField
        );
    }

    private fetchImportantUrgentFiles(): void {
        if (!this.options.app) return;

        this.allFiles = this.options.app.vault.getMarkdownFiles().filter((file) => {
            const cache = this.options.app?.metadataCache.getFileCache(file);
            return this.hasIncompleteTaskWithTag(cache, "#p1");
        });

        this.allFiles = this.sortFilesByTimeField(
            this.allFiles,
            this.options.timeField
        );
    }

    private hasIncompleteTaskWithTag(cache: CachedMetadata | null | undefined, tag: string): boolean {
        if (!cache?.listItems || !cache.tags) return false;
        const normalizedTag = tag.toLowerCase();
        const tags = cache.tags.filter(item => item.tag.toLowerCase() === normalizedTag);
        if (tags.length === 0) return false;

        return cache.listItems.some(item => item.task === " " && this.listItemContainsTag(item, tags));
    }

    private listItemContainsTag(item: ListItemCache, tags: TagCache[]): boolean {
        const startLine = item.position.start.line;
        const endLine = item.position.end.line;
        return tags.some(tag => {
            const tagLine = tag.position.start.line;
            return tagLine >= startLine && tagLine <= endLine;
        });
    }

    private isTodayTimestamp(timestamp: number): boolean {
        return moment(timestamp).isSame(moment(), "day");
    }

    private isJournalFile(file: TFile): boolean {
        const folderPath = file.parent?.path || "";
        const journalFolders = this.options.journalFolders && this.options.journalFolders.length > 0
            ? this.options.journalFolders
            : ["journals"];

        return journalFolders.some(folder => {
            const normalized = folder.trim().replace(/^\/+|\/+$/g, "");
            if (!normalized) return false;
            return folderPath === normalized || folderPath.startsWith(normalized + "/");
        });
    }

    private isTodayJournalFile(file: TFile): boolean {
        if (this.isTodayTimestamp(file.stat.ctime) || this.isTodayTimestamp(file.stat.mtime)) {
            return true;
        }

        const today = moment();
        const candidates = [
            today.format("YYYY-MM-DD"),
            today.format("YYYYMMDD"),
            today.format("YYYY_MM_DD"),
            today.format("YYYY.MM.DD"),
        ];
        return candidates.some(token => file.basename.includes(token) || file.path.includes(token));
    }

    private filterFilesByRange(): void {
        if (!this.options.timeRange || this.options.timeRange === "all") {
            this.filteredFiles = [...this.allFiles];
            return;
        }

        const { baseTimeField } = this.parseTimeField(
            this.options.timeField
        );

        let now = moment();
        let cutoff: moment.Moment;

        if (this.options.timeRange === "custom" && this.options.customRange) {
            // Custom range: filter files between start and end date
            const startDate = moment(this.options.customRange.start);
            const endDate = moment(this.options.customRange.end);

            this.filteredFiles = this.allFiles.filter((file) => {
                const fileTime = moment(file.stat[baseTimeField]);
                return fileTime.isBetween(startDate, endDate, 'day', '[]');
            });
            return;
        }

        // Calculate the date threshold based on the time range
        switch (this.options.timeRange) {
            case "week":
                cutoff = now.clone().subtract(1, "week");
                break;
            case "month":
                cutoff = now.clone().subtract(1, "month");
                break;
            case "quarter":
                cutoff = now.clone().subtract(3, "months");
                break;
            case "year":
                cutoff = now.clone().subtract(1, "year");
                break;
            case "last-week":
                cutoff = now.clone().subtract(1, "week");
                now = now.clone().subtract(1, "week");
                break;
            case "last-month":
                cutoff = now.clone().subtract(1, "month");
                cutoff = cutoff.clone().startOf("month");
                now = now.clone().startOf("month");
                break;
            case "last-quarter":
                cutoff = now.clone().subtract(3, "months");
                cutoff = cutoff.clone().startOf("month");
                now = now.clone().subtract(3, "months");
                now = now.clone().endOf("month");
                break;
            case "last-year":
                cutoff = now.clone().subtract(1, "year");
                cutoff = cutoff.clone().startOf("year");
                now = now.clone().subtract(1, "year");
                now = now.clone().endOf("year");
                break;
            default:
                cutoff = now.clone().subtract(1, "week");
        }

        this.filteredFiles = this.allFiles.filter((file) => {
            const fileTime = moment(file.stat[baseTimeField]);
            return fileTime.isAfter(cutoff);
        });

        // Apply the sort
        this.filteredFiles = this.sortFilesByTimeField(
            this.filteredFiles,
            this.options.timeField
        );
    }

    public fileCreate(file: TFile): void {
        // Handle file creation for folder and tag modes
        if (this.options.mode === "folder") {
            if (!this.options.target || !this.options.app) return;
            const folderPath = file.parent?.path || "";
            if (
                folderPath === this.options.target ||
                folderPath.startsWith(this.options.target + "/")
            ) {
                this.allFiles.push(file);
                // Sort and update filtered files
                this.allFiles = this.sortFilesByTimeField(
                    this.allFiles,
                    this.options.timeField
                );
                this.filterFilesByRange();
            }
        } else if (this.options.mode === "tag") {
            this.handleTaggedFileCreate(file);
        } else if (this.options.mode === "overview") {
            this.forceRefresh();
        }
    }

    private handleTaggedFileCreate(file: TFile): void {
        if (!this.options.target || !this.options.app) return;
        if (this.isExcluded(file)) return;

        const targetTags = this.options.target
            .split("+")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
            .map((t) => (t.startsWith("#") ? t : "#" + t));

        const fileCache = this.options.app.metadataCache.getFileCache(file);
        if (!fileCache) return;

        const tags = getAllTags(fileCache) || [];
        const includeSubTags = this.options.includeSubTags ?? false;
        const matches = tags.some((tag) => {
            const tagLower = tag.toLowerCase();
            return targetTags.some((targetTag) => {
                if (includeSubTags) {
                    return tagLower === targetTag || tagLower.startsWith(targetTag + '/');
                }
                return tagLower === targetTag;
            });
        });

        if (matches) {
            this.allFiles.push(file);

            this.allFiles = this.sortFilesByTimeField(
                this.allFiles,
                this.options.timeField
            );

            this.filterFilesByRange();
        }
    }

    public fileDelete(file: TFile): void {
        this.filteredFiles = this.filteredFiles.filter((f) => {
            return f.path !== file.path;
        });
        this.allFiles = this.allFiles.filter((f) => {
            return f.path !== file.path;
        });
    }

    public getAllFiles(): TFile[] {
        return this.allFiles;
    }

    public getFilteredFiles(): TFile[] {
        return this.filteredFiles;
    }

    public updateOptions(options: Partial<FileManagerOptions>): void {
        this.options = { ...this.options, ...options };

        if (
            options.mode ||
            options.target ||
            options.includeSubTags !== undefined ||
            options.excludedFolders !== undefined ||
            options.journalFolders !== undefined
        ) {
            this.allFiles = [];
            this.filteredFiles = [];
            this.hasFetched = false;
            this.fetchFiles();
        } else if (options.timeRange || options.customRange || options.timeField) {
            this.allFiles = this.sortFilesByTimeField(
                this.allFiles,
                this.options.timeField
            );
            this.filterFilesByRange();
        }
    }

    public forceRefresh(): void {
        this.allFiles = [];
        this.filteredFiles = [];
        this.hasFetched = false;
        this.fetchFiles();
    }
}
