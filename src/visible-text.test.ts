import { afterEach, describe, expect, it, vi } from "vitest";
import { countOccurrences } from "./match-text";
import {
    collectOwnTextNodes,
    inspectVisibleTextFromBlockElement,
    visibleTextFromBlockDom,
    visibleTextFromBlockElement,
} from "./visible-text";

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

describe("collectOwnTextNodes（活 DOM 与离屏对齐）", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("挂载后的活 DOM 与离屏 HTML 抽出同一可见文本", async () => {
        const wrap = document.createElement("div");
        wrap.innerHTML = LINK_BLOCK_DOM;
        document.body.appendChild(wrap);
        const block = wrap.querySelector("[data-node-id]") as HTMLElement;

        const live = visibleTextFromBlockElement(block);
        const offscreen = await visibleTextFromBlockDom(LINK_BLOCK_DOM);
        expect(live).toBe(offscreen);
        expect(collectOwnTextNodes(block).text).toBe(live);
    });

    it("活 DOM 同样跳过嵌套子块正文", () => {
        const wrap = document.createElement("div");
        wrap.innerHTML =
            `<div data-node-id="li1" data-type="NodeListItem" class="li">` +
            `<div data-node-id="p1" data-type="NodeParagraph" class="p">` +
            `<div contenteditable="true">嵌套命中词</div>` +
            `</div></div>`;
        document.body.appendChild(wrap);
        const li = wrap.querySelector('[data-node-id="li1"]') as HTMLElement;
        const p = wrap.querySelector('[data-node-id="p1"]') as HTMLElement;
        expect(visibleTextFromBlockElement(li)).not.toContain("嵌套命中词");
        expect(visibleTextFromBlockElement(p)).toBe("嵌套命中词");
    });
});

describe("图表 data-content 回退", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    const MERMAID_DOM =
        `<div data-node-id="mermaid1" data-type="NodeCodeBlock" class="render-node" ` +
        `data-subtype="mermaid" ` +
        `data-content="classDiagram&#10;Class01 &amp;lt;|-- AveryLongClass : Cool">` +
        `<div></div><div class="protyle-attr">\u200B</div></div>`;

    it("离屏无 SVG 时用 data-content 源码（含反转义）", async () => {
        const text = await visibleTextFromBlockDom(MERMAID_DOM);
        expect(text).toContain("classDiagram");
        expect(text).toContain("Class01");
        expect(text).toContain("AveryLongClass");
        expect(text).toContain("Cool");
        expect(text).toContain("<|--");
        expect(countOccurrences(text, "Cool", false)).toBeGreaterThanOrEqual(1);
    });

    it("活 DOM 无正文时才回退 data-content", () => {
        const wrap = document.createElement("div");
        wrap.innerHTML = MERMAID_DOM;
        document.body.appendChild(wrap);
        const block = wrap.querySelector("[data-node-id]") as HTMLElement;
        const info = inspectVisibleTextFromBlockElement(block);
        expect(info.text).toContain("Cool");
        expect(info.text).toContain("<|--");
        expect(info.fromDataContent).toBe(true);
    });

    it("活 DOM 已有可见正文时用元素文本而非 data-content", () => {
        const wrap = document.createElement("div");
        wrap.innerHTML =
            `<div data-node-id="mermaid1" data-type="NodeCodeBlock" class="render-node" ` +
            `data-subtype="mermaid" data-content="classDiagram&#10;SecretSourceToken">` +
            `<div><svg><text>Cool label</text></svg></div>` +
            `<div class="protyle-attr">\u200B</div></div>`;
        document.body.appendChild(wrap);
        const block = wrap.querySelector("[data-node-id]") as HTMLElement;
        const info = inspectVisibleTextFromBlockElement(block);
        expect(info.text).toContain("Cool label");
        expect(info.text).not.toContain("SecretSourceToken");
        expect(info.text).not.toContain("classDiagram");
        expect(info.fromDataContent).toBe(false);
    });

    it("不同父元素的文本节点之间插入空格", () => {
        const wrap = document.createElement("div");
        wrap.innerHTML =
            `<div data-node-id="m1" data-type="NodeCodeBlock" class="render-node" data-subtype="mermaid">` +
            `<svg><text>Cool</text><text>Where</text><text>Class01</text></svg></div>`;
        document.body.appendChild(wrap);
        const block = wrap.querySelector("[data-node-id]") as HTMLElement;
        expect(collectOwnTextNodes(block).text).toBe("Cool Where Class01");
    });

    it("SVG 上 aria-hidden 仍收集可见标签文本", () => {
        const wrap = document.createElement("div");
        wrap.innerHTML =
            `<div data-node-id="m1" data-type="NodeCodeBlock" class="render-node" data-subtype="mermaid">` +
            `<svg aria-hidden="true"><text>Class01</text></svg></div>`;
        document.body.appendChild(wrap);
        const block = wrap.querySelector("[data-node-id]") as HTMLElement;
        expect(collectOwnTextNodes(block).text).toContain("Class01");
    });

    it("无 subtype 时只要有 data-content 也可回退", () => {
        const wrap = document.createElement("div");
        wrap.innerHTML =
            `<div data-node-id="m1" data-type="NodeCodeBlock" data-content="classDiagram&#10;Class01">` +
            `<div>\n    \n    \n</div></div>`;
        document.body.appendChild(wrap);
        const block = wrap.querySelector("[data-node-id]") as HTMLElement;
        expect(visibleTextFromBlockElement(block)).toContain("Class01");
    });

    it("同一段落内 strong 拆分不插入空格", () => {
        const wrap = document.createElement("div");
        wrap.innerHTML =
            `<div data-node-id="p1" data-type="NodeParagraph" class="p">` +
            `<div contenteditable="true">hel<strong>lo</strong>世界</div></div>`;
        document.body.appendChild(wrap);
        const block = wrap.querySelector("[data-node-id]") as HTMLElement;
        expect(collectOwnTextNodes(block).text).toBe("hello世界");
    });
});
