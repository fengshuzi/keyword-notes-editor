import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCornellDocument } from "../src/utils/cornellParser.ts";

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

describe("parseCornellDocument 结构解析", () => {
    it("导语 + 多个线索区 + 最后一区作为总结", async () => {
        const content = [
            "导语部分",
            "",
            "## 线索一",
            "正文一",
            "",
            "## 线索二",
            "正文二",
            "",
            "## 总结",
            "总结内容",
        ].join("\n");
        const doc = await parseCornellDocument(makeApp(content), makeFile("notes/a.md"));

        assert.deepEqual(doc.topic, { cue: "", body: "导语部分" });
        assert.equal(doc.rows.length, 2);
        assert.deepEqual(doc.rows[0], { cue: "线索一", body: "正文一" });
        assert.deepEqual(doc.rows[1], { cue: "线索二", body: "正文二" });
        assert.deepEqual(doc.summary, { cue: "总结", body: "总结内容" });
        assert.equal(doc.hasCues, true);
        assert.equal(doc.isEmpty, false);
    });

    it("只有一个 ## 时不拆总结", async () => {
        const content = ["## 唯一线索", "正文"].join("\n");
        const doc = await parseCornellDocument(makeApp(content), makeFile("notes/a.md"));

        assert.equal(doc.topic, null);
        assert.equal(doc.rows.length, 1);
        assert.deepEqual(doc.rows[0], { cue: "唯一线索", body: "正文" });
        assert.equal(doc.summary, null);
        assert.equal(doc.hasCues, true);
    });

    it("没有任何 ## 时整篇作为导语", async () => {
        const doc = await parseCornellDocument(makeApp("只有导语"), makeFile("notes/a.md"));

        assert.deepEqual(doc.topic, { cue: "", body: "只有导语" });
        assert.deepEqual(doc.rows, []);
        assert.equal(doc.summary, null);
        assert.equal(doc.hasCues, false);
    });

    it("正则兜底路径跳过代码块内的 ##", async () => {
        const fence = "```text";
        const content = ["## 线索", "正文", "", fence, "## 伪线索", "```"].join("\n");
        const doc = await parseCornellDocument(makeApp(content), makeFile("notes/a.md"));

        assert.equal(doc.rows.length, 1);
        assert.equal(doc.rows[0].cue, "线索");
    });

    it("frontmatter 不参与显示，只有 frontmatter 时判定为空", async () => {
        const doc = await parseCornellDocument(
            makeApp("---\ntags: [a]\n---\n"),
            makeFile("notes/a.md")
        );

        assert.equal(doc.topic, null);
        assert.equal(doc.hasCues, false);
        assert.equal(doc.isEmpty, true);
    });

    it("metadataCache headings 路径优先于正则兜底", async () => {
        const source = "导语\n\n## 线索一\n正文一\n\n## 总结\n总结内容";
        const first = source.indexOf("## 线索一");
        const second = source.indexOf("## 总结");
        const cache = {
            headings: [
                { level: 2, heading: "线索一", position: { start: { offset: first } } },
                { level: 2, heading: "总结", position: { start: { offset: second } } },
            ],
        };
        const doc = await parseCornellDocument(makeApp(source, cache), makeFile("notes/a.md"));

        assert.deepEqual(doc.topic, { cue: "", body: "导语" });
        assert.equal(doc.rows.length, 1);
        assert.deepEqual(doc.rows[0], { cue: "线索一", body: "正文一" });
        assert.deepEqual(doc.summary, { cue: "总结", body: "总结内容" });
    });
});
