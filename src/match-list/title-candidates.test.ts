import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTitleMatches } from "./title-candidates";

beforeAll(() => {
    // jsdom 的 checkVisibility 常为 false
    HTMLElement.prototype.checkVisibility = () => true;
});

beforeEach(() => {
    document.body.innerHTML = "";
});

function mountProtyle(html: string): HTMLElement {
    const protyle = document.createElement("div");
    protyle.className = "protyle";
    protyle.innerHTML = html;
    document.body.appendChild(protyle);
    return protyle;
}

const TITLE_PROTYLE = `
    <div class="protyle-content">
        <div class="protyle-top">
            <div class="protyle-title" data-node-id="doc-id" data-render="true"><div class="protyle-title__rich protyle protyle-lite-fragment"><div class="protyle-content"><div class="protyle-wysiwyg"><div data-node-id="temp-title-p" data-type="NodeParagraph" class="p"><div class="protyle-title__input" contenteditable="true">文档 关键词 与 关键词</div></div></div></div></div></div>
        </div>
        <div class="protyle-wysiwyg">
            <div data-node-id="body-p" data-type="NodeParagraph" class="p">
                <div contenteditable="true">正文 关键词</div>
            </div>
        </div>
    </div>`;

describe("buildTitleMatches", () => {
    it("按标题 DOM 文本逐处展开匹配", () => {
        const protyle = mountProtyle(TITLE_PROTYLE);

        const matches = buildTitleMatches(protyle, "关键词", false, false);

        expect(matches.map((match) => [match.blockId, match.occ])).toEqual([
            ["doc-id", 0],
            ["doc-id", 1],
        ]);
        expect(matches[0].snippet).toContain("关键词");
    });

    it("区分大小写与全字匹配照常生效", () => {
        const protyle = mountProtyle(TITLE_PROTYLE);

        expect(buildTitleMatches(protyle, "文档", true, false)).toHaveLength(1);
        expect(buildTitleMatches(protyle, "文档 关键词", false, true)).toHaveLength(1);
        expect(buildTitleMatches(protyle, "文", false, true)).toEqual([]);
    });

    it("标题隐藏时不产生匹配", () => {
        const protyle = mountProtyle(TITLE_PROTYLE);
        (protyle.querySelector(".protyle-title") as HTMLElement).classList.add("fn__none");

        expect(buildTitleMatches(protyle, "关键词", false, false)).toEqual([]);
    });

    it("不把标题片段编辑器里的预览、工具栏面板当成标题文本", () => {
        const protyle = mountProtyle(`
            <div class="protyle-content">
                <div class="protyle-title" data-node-id="doc-id" data-render="true">
                    <div class="protyle-title__rich protyle protyle-lite-fragment">
                        <div class="protyle-preview fn__none">
                            <div class="protyle-preview__action"><button data-type="desktop">桌面</button><button data-type="tablet">平板</button><button data-type="mobile">移动端</button></div>
                            <div class="b3-typography"></div>
                        </div>
                        <div class="protyle-content">
                            <div class="protyle-wysiwyg">
                                <div data-node-id="temp-title-p" data-type="NodeParagraph" class="p">
                                    <div class="protyle-title__input" contenteditable="true">123123</div>
                                </div>
                            </div>
                        </div>
                        <div class="protyle-util fn__none"><span>字体</span><span>字号</span></div>
                    </div>
                </div>
                <div class="protyle-wysiwyg"></div>
            </div>`);

        expect(buildTitleMatches(protyle, "桌面", false, false)).toEqual([]);
        expect(buildTitleMatches(protyle, "字号", false, false)).toEqual([]);
        expect(buildTitleMatches(protyle, "123", false, false).map((match) => match.occ)).toEqual([0, 1]);
    });
});
