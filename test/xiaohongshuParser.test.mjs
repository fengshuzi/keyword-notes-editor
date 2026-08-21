import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseXiaohongshuCards } from "../src/utils/xiaohongshuParser.ts";

function makeFile(path) {
    const name = path.split("/").pop();
    return { path, basename: name.replace(/\.md$/, "") };
}

function makeApp(content, cache = null) {
    return {
        vault: {
            async cachedRead() {
                return content;
            },
        },
        metadataCache: {
            getFileCache: () => cache,
        },
    };
}

describe("parseXiaohongshuCards 切图规则", () => {
    it("按 H2 切卡，标题前内容不生成卡片，frontmatter 提供 title/tags", async () => {
        const content = [
            "---",
            "title: 我的笔记",
            "tags: [小红书, 笔记]",
            "---",
            "",
            "# 忽略的顶级标题",
            "",
            "## 卡片一",
            "内容A",
            "",
            "## 卡片二",
            "内容B",
            "",
            "## 正文",
            "正文内容",
        ].join("\n");
        const cache = { frontmatter: { title: "我的笔记", tags: ["小红书", "笔记"] } };
        const app = makeApp(content, cache);
        const cards = await parseXiaohongshuCards(app, makeFile("notes/a.md"));

        assert.equal(cards.length, 3);
        assert.deepEqual(cards.map((c) => c.cardTitle), ["卡片一", "卡片二", "正文"]);
        assert.equal(cards[0].body, "内容A");
        assert.equal(cards[0].noteTitle, "我的笔记");
        assert.ok(cards[0].tags.includes("#小红书"));
        assert.ok(cards[0].tags.includes("#笔记"));
        assert.equal(cards[0].total, 3);
        assert.deepEqual(cards.map((c) => c.cardIndex), [0, 1, 2]);
    });

    it("没有 H2 时按 H1 切卡（H1 fallback）", async () => {
        const content = ["# 甲", "a", "", "# 乙", "b"].join("\n");
        const cards = await parseXiaohongshuCards(makeApp(content), makeFile("notes/a.md"));

        assert.equal(cards.length, 2);
        assert.deepEqual(cards.map((c) => c.cardTitle), ["甲", "乙"]);
    });

    it("同一标题下用 --- 继续分页，标题重复且不残留切图线", async () => {
        const content = ["## 主题", "第一页", "", "---", "", "第二页"].join("\n");
        const cards = await parseXiaohongshuCards(makeApp(content), makeFile("notes/a.md"));

        assert.equal(cards.length, 2);
        assert.equal(cards[0].cardTitle, "主题");
        assert.equal(cards[1].cardTitle, "主题");
        assert.equal(cards[0].body, "第一页");
        assert.equal(cards[1].body, "第二页");
        assert.equal(cards[0].total, 2);
    });

    it("围栏代码块内的 ## 与 --- 不参与切分", async () => {
        const fence = "```md";
        const content = [
            "## 外层",
            "正文",
            "",
            fence,
            "## 假标题",
            "---",
            "```",
            "",
            "## 真第二节",
            "内容",
        ].join("\n");
        const cards = await parseXiaohongshuCards(makeApp(content), makeFile("notes/a.md"));

        assert.equal(cards.length, 2);
        assert.deepEqual(cards.map((c) => c.cardTitle), ["外层", "真第二节"]);
        assert.ok(cards[0].body.includes("假标题"));
    });

    it("没有任何标题时返回空数组", async () => {
        const content = "只有正文，没有任何标题。";
        const cards = await parseXiaohongshuCards(makeApp(content), makeFile("notes/a.md"));

        assert.deepEqual(cards, []);
    });

    it("frontmatterPosition 缓存路径也能定位内容起点", async () => {
        const source = "---\ntitle: 缓存标题\n---\n\n## 一\n内容";
        const end = source.indexOf("---", 3) + 3;
        const cache = {
            frontmatter: { title: "缓存标题" },
            frontmatterPosition: { end: { offset: end } },
        };
        const cards = await parseXiaohongshuCards(makeApp(source, cache), makeFile("notes/a.md"));

        assert.equal(cards.length, 1);
        assert.equal(cards[0].noteTitle, "缓存标题");
        assert.equal(cards[0].cardTitle, "一");
    });

    it("frontmatter 无 title 时回退到文件名", async () => {
        const content = ["## 一", "内容"].join("\n");
        const cards = await parseXiaohongshuCards(makeApp(content), makeFile("notes/文件名.md"));

        assert.equal(cards[0].noteTitle, "文件名");
    });
});

describe("parseXiaohongshuCards 标签收集", () => {
    it("frontmatter 标签 + 行内标签合并去重，最多 4 个", async () => {
        const content = [
            "---",
            "tags: [t1, t2]",
            "---",
            "",
            "## 一",
            "正文 #t3 #t4 #t5 #t1",
        ].join("\n");
        const cache = { frontmatter: { tags: ["t1", "t2"] } };
        const cards = await parseXiaohongshuCards(makeApp(content, cache), makeFile("notes/a.md"));

        assert.deepEqual(cards[0].tags, ["#t1", "#t2", "#t3", "#t4"]);
    });

    it("代码块内的行内标签不收集", async () => {
        const fence = "```text";
        const content = ["## 一", "正文 #ok", "", fence, "#bad", "```"].join("\n");
        const cards = await parseXiaohongshuCards(makeApp(content), makeFile("notes/a.md"));

        assert.deepEqual(cards[0].tags, ["#ok"]);
    });
});
