import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    XIAOHONGSHU_THEMES,
    getXiaohongshuTheme,
    isXiaohongshuThemeId,
} from "../src/utils/xiaohongshuThemes.ts";
import { genId } from "../src/utils/utils.ts";

describe("xiaohongshuThemes", () => {
    it("按 id 查找主题", () => {
        assert.equal(getXiaohongshuTheme("dark").name, "深色");
        assert.equal(getXiaohongshuTheme("memo").name, "备忘录");
    });

    it("未知 id 回退到第一个主题", () => {
        assert.equal(getXiaohongshuTheme("not-exist").id, "light");
    });

    it("isXiaohongshuThemeId 只认已知 id", () => {
        for (const theme of XIAOHONGSHU_THEMES) {
            assert.equal(isXiaohongshuThemeId(theme.id), true);
        }
        assert.equal(isXiaohongshuThemeId("bogus"), false);
        assert.equal(isXiaohongshuThemeId(""), false);
    });

    it("主题 id 不重复", () => {
        const ids = XIAOHONGSHU_THEMES.map((theme) => theme.id);
        assert.equal(new Set(ids).size, ids.length);
    });
});

describe("genId", () => {
    it("生成指定长度的十六进制字符串", () => {
        const id = genId(8);
        assert.equal(id.length, 8);
        assert.match(id, /^[0-9a-f]+$/);
    });

    it("长度为 0 时返回空字符串", () => {
        assert.equal(genId(0), "");
    });

    it("两次调用结果不同", () => {
        assert.notEqual(genId(16), genId(16));
    });
});
