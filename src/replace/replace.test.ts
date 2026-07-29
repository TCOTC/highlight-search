import { beforeAll, describe, expect, it } from "vitest";
import { buildReplaceStringWithCasePreserved } from "./preserve-case";
import {
    isReplaceable,
    REPLACEABLE_BLOCK_TYPES,
    REPLACEABLE_INLINE_TOKENS,
} from "./is-replaceable";
import type { FindMatch } from "../find-match";
import { clearHighlight, getDomHits, highlightDomHits } from "../highlight";

beforeAll(() => {
    const store = new Map<string, unknown>();
    // jsdom 无 CSS Highlight API
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).CSS = {
        highlights: {
            set(name: string, value: unknown) {
                store.set(name, value);
            },
            delete(name: string) {
                store.delete(name);
            },
        },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Highlight = class {
        constructor(..._ranges: Range[]) {}
    };
    // jsdom 的 checkVisibility 常为 false，导致 DomHit Range 建不出来
    HTMLElement.prototype.checkVisibility = () => true;
});

describe("buildReplaceStringWithCasePreserved", () => {
    it("全大写 / 全小写 / 首字母", () => {
        expect(buildReplaceStringWithCasePreserved("HELLO", "goodbye")).toBe("GOODBYE");
        expect(buildReplaceStringWithCasePreserved("hello", "GoodBye")).toBe("goodbye");
        expect(buildReplaceStringWithCasePreserved("Hello", "goodbye")).toBe("Goodbye");
        expect(buildReplaceStringWithCasePreserved("hELLO", "GoodBye")).toBe("goodBye");
    });

    it("驼峰靠替换串自身 + 首字母规则", () => {
        expect(buildReplaceStringWithCasePreserved("onetwothree", "fourFiveSix")).toBe(
            "fourfivesix",
        );
        expect(buildReplaceStringWithCasePreserved("oneTwoThree", "fourFiveSix")).toBe(
            "fourFiveSix",
        );
        expect(buildReplaceStringWithCasePreserved("OneTwoThree", "fourFiveSix")).toBe(
            "FourFiveSix",
        );
    });

    it("连字符 / 下划线按段", () => {
        expect(buildReplaceStringWithCasePreserved("Foo-Bar", "test-replace")).toBe(
            "Test-Replace",
        );
        expect(buildReplaceStringWithCasePreserved("FOO_BAR", "test_replace")).toBe(
            "TEST_REPLACE",
        );
    });
});

describe("isReplaceable 白名单", () => {
    const source = {};

    function mount(html: string): { protyleEl: HTMLElement; blockEl: HTMLElement } {
        const protyleEl = document.createElement("div");
        protyleEl.className = "protyle";
        protyleEl.innerHTML = `
            <div class="protyle-content">
                <div class="protyle-wysiwyg">
                    ${html}
                </div>
            </div>
        `;
        document.body.appendChild(protyleEl);
        const blockEl = protyleEl.querySelector("[data-node-id]") as HTMLElement;
        return { protyleEl, blockEl };
    }

    function matchFor(blockId: string, extra?: Partial<FindMatch>): FindMatch {
        return { blockId, occ: 0, ...extra };
    }

    function prepareHits(protyleEl: Element, needle: string) {
        highlightDomHits(source, protyleEl, needle, false, false);
        return () => clearHighlight(source);
    }

    it("导出白名单常量完整", () => {
        expect(REPLACEABLE_BLOCK_TYPES.has("NodeParagraph")).toBe(true);
        expect(REPLACEABLE_BLOCK_TYPES.has("NodeTable")).toBe(true);
        expect(REPLACEABLE_INLINE_TOKENS.has("block-ref")).toBe(true);
        expect(REPLACEABLE_INLINE_TOKENS.has("tag")).toBe(true);
        expect(REPLACEABLE_INLINE_TOKENS.has("virtual-block-ref")).toBe(true);
        expect(REPLACEABLE_INLINE_TOKENS.has("inline-math")).toBe(false);
    });

    it("段落纯文本可替换", () => {
        const { protyleEl, blockEl } = mount(
            `<div data-node-id="p1" data-type="NodeParagraph" class="p"><div contenteditable="true">hello world</div></div>`,
        );
        const cleanup = prepareHits(protyleEl, "hello");
        expect(getDomHits(source).length).toBeGreaterThan(0);
        const result = isReplaceable({
            match: matchFor("p1"),
            protyleEl,
            source,
        });
        expect(result.ok).toBe(true);
        expect(result.blockEl).toBe(blockEl);
        cleanup();
        protyleEl.remove();
    });

    it("fromDataContent 不可替换", () => {
        const { protyleEl } = mount(
            `<div data-node-id="p1" data-type="NodeParagraph" class="p"><div contenteditable="true">hello</div></div>`,
        );
        const cleanup = prepareHits(protyleEl, "hello");
        const result = isReplaceable({
            match: matchFor("p1", { fromDataContent: true }),
            protyleEl,
            source,
        });
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("from-data-content");
        cleanup();
        protyleEl.remove();
    });

    it("公式块不可替换", () => {
        const { protyleEl } = mount(
            `<div data-node-id="m1" data-type="NodeMathBlock" data-subtype="math" class="render-node"><div contenteditable="false">E=mc^2</div></div>`,
        );
        const cleanup = prepareHits(protyleEl, "mc");
        const result = isReplaceable({
            match: matchFor("m1"),
            protyleEl,
            source,
        });
        expect(result.ok).toBe(false);
        expect(["block-type", "no-dom-hit"]).toContain(result.reason);
        cleanup();
        protyleEl.remove();
    });

    it("图表 render-node 代码块不可替换", () => {
        const { protyleEl } = mount(
            `<div data-node-id="c1" data-type="NodeCodeBlock" class="code-block render-node" data-subtype="mermaid"><div>graph TD</div></div>`,
        );
        const cleanup = prepareHits(protyleEl, "graph");
        const result = isReplaceable({
            match: matchFor("c1"),
            protyleEl,
            source,
        });
        expect(result.ok).toBe(false);
        expect(["code-render-node", "no-dom-hit"]).toContain(result.reason);
        cleanup();
        protyleEl.remove();
    });

    it("普通代码块可替换", () => {
        const { protyleEl } = mount(
            `<div data-node-id="c1" data-type="NodeCodeBlock" class="code-block"><div contenteditable="true" class="hljs">const hello = 1</div></div>`,
        );
        const cleanup = prepareHits(protyleEl, "hello");
        const result = isReplaceable({
            match: matchFor("c1"),
            protyleEl,
            source,
        });
        expect(result.ok).toBe(true);
        cleanup();
        protyleEl.remove();
    });

    it("嵌入块内段落不可替换", () => {
        const { protyleEl } = mount(
            `<div data-node-id="e1" data-type="NodeBlockQueryEmbed">
                <div class="protyle-wysiwyg__embed">
                    <div data-node-id="p1" data-type="NodeParagraph" class="p"><div contenteditable="true">hello embed</div></div>
                </div>
            </div>`,
        );
        const cleanup = prepareHits(protyleEl, "hello");
        const result = isReplaceable({
            match: matchFor("p1"),
            protyleEl,
            source,
        });
        expect(result.ok).toBe(false);
        cleanup();
        protyleEl.remove();
    });

    it("行内公式不可替换", () => {
        const { protyleEl } = mount(
            `<div data-node-id="p1" data-type="NodeParagraph" class="p"><div contenteditable="true">前 <span data-type="inline-math" data-subtype="math" contenteditable="false"><span class="katex"><span class="katex-html">alpha</span></span></span> 后</div></div>`,
        );
        const cleanup = prepareHits(protyleEl, "alpha");
        const result = isReplaceable({
            match: matchFor("p1"),
            protyleEl,
            source,
        });
        expect(result.ok).toBe(false);
        cleanup();
        protyleEl.remove();
    });

    it("block-ref 锚文本可替换", () => {
        const { protyleEl } = mount(
            `<div data-node-id="p1" data-type="NodeParagraph" class="p"><div contenteditable="true">见 <span data-type="block-ref" data-subtype="d" data-id="x" contenteditable="false">helloRef</span></div></div>`,
        );
        const cleanup = prepareHits(protyleEl, "helloRef");
        const result = isReplaceable({
            match: matchFor("p1"),
            protyleEl,
            source,
        });
        expect(result.ok).toBe(true);
        cleanup();
        protyleEl.remove();
    });

    it("虚拟引用可见文本可替换", () => {
        const { protyleEl } = mount(
            `<div data-node-id="p1" data-type="NodeParagraph" class="p"><div contenteditable="true">见 <span data-type="virtual-block-ref">helloVirt</span></div></div>`,
        );
        const cleanup = prepareHits(protyleEl, "helloVirt");
        const result = isReplaceable({
            match: matchFor("p1"),
            protyleEl,
            source,
        });
        expect(result.ok).toBe(true);
        cleanup();
        protyleEl.remove();
    });

    it("表格单元格可替换", () => {
        const { protyleEl } = mount(
            `<div data-node-id="t1" data-type="NodeTable" class="table"><div contenteditable="true"><table><tr><td>hello cell</td></tr></table></div></div>`,
        );
        const cleanup = prepareHits(protyleEl, "hello");
        const result = isReplaceable({
            match: matchFor("t1"),
            protyleEl,
            source,
        });
        expect(result.ok).toBe(true);
        cleanup();
        protyleEl.remove();
    });
});
