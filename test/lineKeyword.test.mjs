import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractLineKeywordLines, parseLineKeywords } from "../src/utils/lineKeyword.ts";

describe("linekeyword parser", () => {
    it("解析 + / 逗号聚合并去重", () => {
        assert.deepEqual(parseLineKeywords("#cy+gw, cy, sp"), ["cy", "gw", "sp"]);
    });

    it("只提取 - 开头且标签命中的行", () => {
        const content = [
            "- #cy 餐饮 90",
            "- #sp 今天有运动",
            "#cy 没有列表符",
            "* #cy 星号不算",
            "- 普通行",
        ].join("\n");
        assert.deepEqual(extractLineKeywordLines(content, "cy+sp"), [
            "- #cy 餐饮 90",
            "- #sp 今天有运动",
        ]);
    });

    it("标签边界精确，父标签命中嵌套标签", () => {
        const content = "- #cy 命中\n- #cy2 不命中\n- #cy/food 嵌套命中";
        assert.deepEqual(extractLineKeywordLines(content, "cy"), [
            "- #cy 命中",
            "- #cy/food 嵌套命中",
        ]);
    });

    it("跳过围栏代码块和行内代码标签", () => {
        const content = "```\n- #cy 代码块\n```\n- `#cy` 行内代码\n- #cy 真的";
        assert.deepEqual(extractLineKeywordLines(content, "cy"), ["- #cy 真的"]);
    });

    it("纯数字标签不匹配", () => {
        assert.deepEqual(extractLineKeywordLines("- #123 数字\n- #cy 命中", "123+cy"), ["- #cy 命中"]);
    });
});
