import { afterEach, describe, expect, it, vi } from "vitest";
import { countOccurrences } from "./match-text";
import { visibleTextFromBlockDom } from "./visible-text";

/** 用户反馈的超链接块 DOM（锚文本含 flowchart，href 也含 flowchart.js.org） */
const LINK_BLOCK_DOM = `<div data-node-id="20211213122136-j3etina" data-node-index="83" data-type="NodeParagraph" class="p" updated="20240429095322"><div contenteditable="true" spellcheck="false">语法请参考 <span data-type="a" data-href="https://flowchart.js.org/">flowchart.js</span>。</div><div class="protyle-attr" contenteditable="false">\u200B</div></div>`;

const UNRENDERED_MATH_DOM = `<div data-node-id="math-block" data-type="NodeParagraph" class="p"><div contenteditable="true">公式：<span data-type="inline-math" data-subtype="math" data-content="\\frac{a}{b}" contenteditable="false"></span> 结束</div></div>`;

describe("visibleTextFromBlockDom", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = "";
    });

    it("空 HTML 返回空串", async () => {
        await expect(visibleTextFromBlockDom("")).resolves.toBe("");
    });

    it("不把 data-href 里的 URL 算进可见文本", async () => {
        const text = await visibleTextFromBlockDom(LINK_BLOCK_DOM);
        expect(text).toContain("flowchart.js");
        expect(text).not.toContain("https://");
        expect(text).not.toContain("flowchart.js.org");
    });

    it("搜 Flowchart 时可见文本只计 1 次（不会因 URL 双计）", async () => {
        const text = await visibleTextFromBlockDom(LINK_BLOCK_DOM);
        expect(countOccurrences(text, "Flowchart", false)).toBe(1);
    });

    it("剔除 .protyle-attr 中的零宽占位", async () => {
        const text = await visibleTextFromBlockDom(LINK_BLOCK_DOM);
        expect(text).not.toMatch(/\u200B/);
        expect(text).toBe("语法请参考 flowchart.js。");
    });

    it("剔除 style / script 内容", async () => {
        const html = `<div>可见<style>.x{}</style><script>var a=1</script>文本</div>`;
        await expect(visibleTextFromBlockDom(html)).resolves.toBe("可见文本");
    });

    it("无 Protyle 时不把未渲染公式 LaTeX 源算进可见文本", async () => {
        const text = await visibleTextFromBlockDom(UNRENDERED_MATH_DOM);
        expect(text).not.toContain("\\frac");
        expect(text).toContain("公式：");
        expect(text).toContain("结束");
    });

    it("Protyle mathRender 后提取渲染结果而非 LaTeX 源", async () => {
        vi.stubGlobal("Protyle", {
            mathRender(root: Element) {
                root.querySelectorAll('[data-subtype="math"]').forEach((el) => {
                    el.setAttribute("data-render", "true");
                    el.textContent = "αβ";
                });
            },
        });

        const text = await visibleTextFromBlockDom(UNRENDERED_MATH_DOM);
        expect(text).toContain("αβ");
        expect(text).not.toContain("\\frac");
    });

    it("列表项容器不计入嵌套段落正文（避免与子块重复）", async () => {
        const listItemDom =
            `<div data-node-id="li1" data-type="NodeListItem" class="li">` +
            `<div data-node-id="p1" data-type="NodeParagraph" class="p">` +
            `<div contenteditable="true">嵌套命中词</div>` +
            `<div class="protyle-attr" contenteditable="false">\u200B</div>` +
            `</div>` +
            `<div class="protyle-attr" contenteditable="false">\u200B</div>` +
            `</div>`;
        const liText = await visibleTextFromBlockDom(listItemDom);
        expect(liText).not.toContain("嵌套命中词");

        const paraDom =
            `<div data-node-id="p1" data-type="NodeParagraph" class="p">` +
            `<div contenteditable="true">嵌套命中词</div>` +
            `<div class="protyle-attr" contenteditable="false">\u200B</div>` +
            `</div>`;
        const pText = await visibleTextFromBlockDom(paraDom);
        expect(pText).toBe("嵌套命中词");
    });
});
