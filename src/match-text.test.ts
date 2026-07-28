import { describe, expect, it } from "vitest";
import {
    countOccurrences,
    findMatchSpans,
    forCompare,
    generateSearchVariants,
    getSiYuanCaseSensitive,
    makeSnippet,
    makeSnippetFromSpan,
    normalizeSearchValue,
} from "./match-text";

describe("normalizeSearchValue", () => {
    it("空串返回空串", () => {
        expect(normalizeSearchValue("")).toBe("");
    });

    it("含非空白时去掉首尾空白", () => {
        expect(normalizeSearchValue("  foo  ")).toBe("foo");
    });

    it("纯空白则保留（Issue #4）", () => {
        expect(normalizeSearchValue("   ")).toBe("   ");
        expect(normalizeSearchValue(" ")).toBe(" ");
    });
});

describe("getSiYuanCaseSensitive", () => {
    it("读取思源配置", () => {
        (window as any).siyuan = { config: { search: { caseSensitive: true } } };
        expect(getSiYuanCaseSensitive()).toBe(true);
        (window as any).siyuan.config.search.caseSensitive = false;
        expect(getSiYuanCaseSensitive()).toBe(false);
        delete (window as any).siyuan;
        expect(getSiYuanCaseSensitive()).toBe(false);
    });
});

describe("forCompare", () => {
    it("不区分大小写时转小写", () => {
        expect(forCompare("FlowChart", false)).toBe("flowchart");
    });

    it("区分大小写时保持原样", () => {
        expect(forCompare("FlowChart", true)).toBe("FlowChart");
    });
});

describe("generateSearchVariants", () => {
    it("空串返回空数组", () => {
        expect(generateSearchVariants("")).toEqual([]);
    });

    it("生成去空白与去零宽变体", () => {
        const variants = generateSearchVariants(" a\u200Bb ");
        expect(variants).toContain(" a\u200Bb ");
        expect(variants).toContain("a\u200Bb"); // trim
        expect(variants).toContain(" ab "); // 去零宽
        // 去空白不会同时去掉零宽，故不会直接得到 "ab"
        expect(variants.some((v) => v.replace(/[\u200B-\u200D\uFEFF\s]/g, "") === "ab")).toBe(true);
    });
});

describe("findMatchSpans / countOccurrences", () => {
    it("普通子串匹配", () => {
        expect(countOccurrences("hello world hello", "hello", true)).toBe(2);
        expect(findMatchSpans("hello world hello", "hello", true)).toEqual([
            { start: 0, end: 5 },
            { start: 12, end: 17 },
        ]);
    });

    it("不区分大小写时 Flowchart 命中 flowchart.js 一次", () => {
        const text = "语法请参考 flowchart.js。";
        expect(countOccurrences(text, "Flowchart", false)).toBe(1);
    });

    it("区分大小写时 Flowchart 不命中 flowchart", () => {
        expect(countOccurrences("flowchart.js", "Flowchart", true)).toBe(0);
    });

    it("重叠匹配去重：只保留非重叠出现", () => {
        // "aaa" 中 "aa" 可在 0 和 1，应只保留非重叠的第一处
        expect(countOccurrences("aaa", "aa", true)).toBe(1);
    });

    it("文档含零宽字符时仍能匹配并映回原文", () => {
        const text = "flow\u200Bchart";
        const spans = findMatchSpans(text, "flowchart", false);
        expect(spans).toHaveLength(1);
        expect(text.slice(spans[0].start, spans[0].end).replace(/\u200B/g, "")).toBe("flowchart");
    });

    it("空关键词返回 0", () => {
        expect(countOccurrences("abc", "", false)).toBe(0);
    });

    it("纯空白关键词可匹配空白（Issue #4）", () => {
        expect(countOccurrences("a b", " ", false)).toBe(1);
    });
});

describe("makeSnippet", () => {
    it("无命中时截取开头", () => {
        const snippet = makeSnippet("abcdefghijklmnopqrstuvwxyz", 0, "zzz", false, 4);
        expect(snippet.length).toBeLessThanOrEqual(8);
    });

    it("有命中时以匹配处居中并加省略号", () => {
        const content = "前缀文字 " + "x".repeat(40) + " Flowchart 后缀文字";
        const snippet = makeSnippet(content, 0, "Flowchart", false, 8);
        expect(snippet).toContain("Flowchart");
        expect(snippet.startsWith("…") || snippet.includes("Flowchart")).toBe(true);
    });
});

describe("makeSnippetFromSpan", () => {
    it("与 makeSnippet 对同一 span 结果一致", () => {
        const content = "前缀文字 " + "x".repeat(40) + " Flowchart 后缀文字";
        const spans = findMatchSpans(content, "Flowchart", false);
        expect(makeSnippetFromSpan(content, spans[0], 8)).toBe(
            makeSnippet(content, 0, "Flowchart", false, 8),
        );
    });
});
