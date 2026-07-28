import { describe, expect, it } from "vitest";
import { countOccurrences } from "./match-text";
import { visibleTextFromBlockDom } from "./visible-text";

/** 用户反馈的超链接块 DOM（锚文本含 flowchart，href 也含 flowchart.js.org） */
const LINK_BLOCK_DOM = `<div data-node-id="20211213122136-j3etina" data-node-index="83" data-type="NodeParagraph" class="p" updated="20240429095322"><div contenteditable="true" spellcheck="false">语法请参考 <span data-type="a" data-href="https://flowchart.js.org/">flowchart.js</span>。</div><div class="protyle-attr" contenteditable="false">\u200B</div></div>`;

describe("visibleTextFromBlockDom", () => {
    it("空 HTML 返回空串", () => {
        expect(visibleTextFromBlockDom("")).toBe("");
    });

    it("不把 data-href 里的 URL 算进可见文本", () => {
        const text = visibleTextFromBlockDom(LINK_BLOCK_DOM);
        expect(text).toContain("flowchart.js");
        expect(text).not.toContain("https://");
        expect(text).not.toContain("flowchart.js.org");
    });

    it("搜 Flowchart 时可见文本只计 1 次（不会因 URL 双计）", () => {
        const text = visibleTextFromBlockDom(LINK_BLOCK_DOM);
        expect(countOccurrences(text, "Flowchart", false)).toBe(1);
    });

    it("剔除 .protyle-attr 中的零宽占位", () => {
        const text = visibleTextFromBlockDom(LINK_BLOCK_DOM);
        expect(text).not.toMatch(/\u200B/);
        expect(text).toBe("语法请参考 flowchart.js。");
    });

    it("剔除 style / script 内容", () => {
        const html = `<div>可见<style>.x{}</style><script>var a=1</script>文本</div>`;
        expect(visibleTextFromBlockDom(html)).toBe("可见文本");
    });
});
