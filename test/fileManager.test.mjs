import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FileManager } from "../src/utils/fileManager.ts";

function makeFile(path, { ctime = 1000, mtime = 1000 } = {}) {
    const parts = path.split("/");
    const name = parts[parts.length - 1];
    return {
        path,
        name,
        basename: name.replace(/\.md$/, ""),
        extension: name.includes(".") ? name.split(".").pop() : "",
        stat: { ctime, mtime, size: 10 },
        parent: { path: parts.slice(0, -1).join("/") },
    };
}

function makeApp(files, caches = new Map()) {
    return {
        vault: {
            getMarkdownFiles: () => files.filter((f) => f.extension === "md"),
        },
        metadataCache: {
            getFileCache: (file) => caches.get(file.path) ?? null,
        },
    };
}

describe("bug 回归：fileCreate 不得把非 md 文件加入笔记列表", () => {
    const cases = ["xiaohongshu", "folder"];
    for (const mode of cases) {
        it(`${mode} 模式下新增图片文件不进入列表`, () => {
            const md = makeFile("notes/a.md");
            const app = makeApp([md]);
            const manager = new FileManager({ mode, target: "notes", app });
            assert.equal(manager.getFilteredFiles().length, 1);

            manager.fileCreate(makeFile("notes/assets/截图.png"));
            manager.fileCreate(makeFile("notes/assets/照片.jpg"));
            manager.fileCreate(makeFile("notes/附件.pdf"));

            const paths = manager.getFilteredFiles().map((f) => f.path);
            assert.deepEqual(paths, ["notes/a.md"]);
        });

        it(`${mode} 模式下新增 md 文件正常进入列表`, () => {
            const md = makeFile("notes/a.md");
            const app = makeApp([md]);
            const manager = new FileManager({ mode, target: "notes", app });

            manager.fileCreate(makeFile("notes/new.md"));

            const paths = manager.getFilteredFiles().map((f) => f.path);
            assert.deepEqual(paths.sort(), ["notes/a.md", "notes/new.md"]);
        });

        it(`${mode} 模式下目标目录之外的文件不进入列表`, () => {
            const md = makeFile("notes/a.md");
            const app = makeApp([md]);
            const manager = new FileManager({ mode, target: "notes", app });

            manager.fileCreate(makeFile("other/b.md"));
            manager.fileCreate(makeFile("other/c.png"));

            assert.equal(manager.getFilteredFiles().length, 1);
        });
    }
});

describe("folder 模式初始扫描", () => {
    it("只包含目标目录及子目录内的 md 文件", () => {
        const inside = makeFile("notes/a.md");
        const insideSub = makeFile("notes/sub/b.md");
        const outside = makeFile("other/c.md");
        const image = makeFile("notes/assets/pic.png");
        const app = makeApp([inside, insideSub, outside, image]);

        const manager = new FileManager({ mode: "folder", target: "notes", app });

        const paths = manager.getFilteredFiles().map((f) => f.path);
        assert.deepEqual(paths.sort(), ["notes/a.md", "notes/sub/b.md"]);
    });

    it("excludedFolders 中的文件被排除", () => {
        const keep = makeFile("notes/a.md");
        const drop = makeFile("notes/archive/b.md");
        const app = makeApp([keep, drop]);

        const manager = new FileManager({
            mode: "folder",
            target: "notes",
            app,
            excludedFolders: ["notes/archive"],
        });

        const paths = manager.getFilteredFiles().map((f) => f.path);
        assert.deepEqual(paths, ["notes/a.md"]);
    });
});

describe("fileDelete", () => {
    it("从列表中移除指定文件", () => {
        const a = makeFile("notes/a.md");
        const b = makeFile("notes/b.md");
        const app = makeApp([a, b]);
        const manager = new FileManager({ mode: "folder", target: "notes", app });

        manager.fileDelete(a);

        const paths = manager.getFilteredFiles().map((f) => f.path);
        assert.deepEqual(paths, ["notes/b.md"]);
    });
});

describe("tag 模式", () => {
    it("只收集带目标标签的笔记（初始扫描与增量 create）", () => {
        const hit = makeFile("notes/hit.md");
        const miss = makeFile("notes/miss.md");
        const caches = new Map([
            ["notes/hit.md", { tags: [{ tag: "#p1" }] }],
            ["notes/miss.md", { tags: [{ tag: "#other" }] }],
        ]);
        const app = makeApp([hit, miss], caches);

        const manager = new FileManager({ mode: "tag", target: "p1", app });
        let paths = manager.getFilteredFiles().map((f) => f.path);
        assert.deepEqual(paths, ["notes/hit.md"]);

        const created = makeFile("notes/hit2.md");
        caches.set("notes/hit2.md", { tags: [{ tag: "#p1" }] });
        manager.fileCreate(created);
        paths = manager.getFilteredFiles().map((f) => f.path);
        assert.deepEqual(paths.sort(), ["notes/hit.md", "notes/hit2.md"]);

        const noCache = makeFile("notes/image.png");
        manager.fileCreate(noCache);
        assert.equal(manager.getFilteredFiles().length, 2);
    });
});

describe("timeRange 过滤", () => {
    it("week 范围内保留新文件，过滤旧文件", () => {
        const now = Date.now();
        const fresh = makeFile("notes/fresh.md", { ctime: now, mtime: now });
        const stale = makeFile("notes/stale.md", {
            ctime: now - 30 * 24 * 3600 * 1000,
            mtime: now - 30 * 24 * 3600 * 1000,
        });
        const app = makeApp([fresh, stale]);

        const manager = new FileManager({
            mode: "folder",
            target: "notes",
            app,
            timeRange: "week",
        });

        const paths = manager.getFilteredFiles().map((f) => f.path);
        assert.deepEqual(paths, ["notes/fresh.md"]);
    });

    it("all / 未设置时保留全部", () => {
        const a = makeFile("notes/a.md", { ctime: 1, mtime: 1 });
        const app = makeApp([a]);

        const manager = new FileManager({ mode: "folder", target: "notes", app });

        assert.equal(manager.getFilteredFiles().length, 1);
    });
});
