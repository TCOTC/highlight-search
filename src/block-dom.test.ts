import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    getDocRoot,
    getDocContentElement,
    findBlockElement,
    isContentBlockElement,
    isDocumentTabProtyle,
    isHiddenByTabs,
    revealHiddenTabAncestors,
} from "./block-dom";
import { calculateDomHits } from "./highlight/dom-hits";

beforeAll(() => {
    // jsdom 的 checkVisibility 常为 false，会掩盖 data-tabs-hidden 的显式判断
    HTMLElement.prototype.checkVisibility = () => true;
});

function mountProtyle(html: string): HTMLElement {
    const protyle = document.createElement("div");
    protyle.className = "protyle";
    protyle.innerHTML = html;
    document.body.appendChild(protyle);
    return protyle;
}

beforeEach(() => {
    document.body.innerHTML = "";
});

const RICH_TITLE_PROTYLE = `
    <div class="protyle-content">
        <div class="protyle-top">
            <div class="protyle-title">
                <div class="protyle-title__rich protyle protyle-lite-fragment">
                    <div class="protyle-content">
                        <div class="protyle-wysiwyg">
                            <div data-node-id="title-p" data-type="NodeParagraph" class="p">
                                <div contenteditable="true">标题 关键词</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="protyle-wysiwyg">
            <div data-node-id="body-p" data-type="NodeParagraph" class="p">
                <div contenteditable="true">正文 关键词</div>
            </div>
        </div>
    </div>`;

describe("getDocRoot", () => {
    it("跳过文档名富文本的嵌套 Protyle", () => {
        const protyle = mountProtyle(RICH_TITLE_PROTYLE);

        const root = getDocRoot(protyle);

        expect(root?.querySelector('[data-node-id="body-p"]')).not.toBeNull();
        expect(root?.querySelector('[data-node-id="title-p"]')).toBeNull();
    });

    it("不会把标题内的临时块当成正文块", () => {
        const protyle = mountProtyle(RICH_TITLE_PROTYLE);

        expect(findBlockElement(protyle, "body-p")).not.toBeNull();
        expect(findBlockElement(protyle, "title-p")).toBeNull();
    });

    it("预览模式下内容区不会选中标题富文本的内层容器", () => {
        const protyle = mountProtyle(`
            <div class="protyle-content fn__none">
                <div class="protyle-title">
                    <div class="protyle-title__rich protyle protyle-lite-fragment">
                        <div class="protyle-content"><div class="protyle-wysiwyg"></div></div>
                    </div>
                </div>
            </div>
            <div class="protyle-preview">
                <div class="b3-typography">
                    <div data-node-id="preview-p" data-type="NodeParagraph" class="p">预览正文</div>
                </div>
            </div>
        `);

        expect(getDocContentElement(protyle)?.classList.contains("protyle-preview")).toBe(true);
        expect(getDocRoot(protyle)?.classList.contains("b3-typography")).toBe(true);
    });
});

const TABS_PROTYLE = `
    <div class="protyle-content">
        <div class="protyle-wysiwyg">
            <div class="tabs" data-type="NodeTabs" data-node-id="tabs" tabs-active-id="tab1">
                <div class="tabs-header">
                    <div class="tabs-list">
                        <button class="tabs-tab" data-tab-id="tab1">One</button>
                        <button class="tabs-tab" data-tab-id="tab2">Two</button>
                    </div>
                </div>
                <div class="tab-item" data-type="NodeTabItem" data-node-id="tab1" data-tabs-hidden="false">
                    <div class="tab-item-info">
                        <div data-node-id="title1" data-type="NodeParagraph" class="p">One</div>
                    </div>
                    <div class="tab-item-content">
                        <div data-node-id="p1" data-type="NodeParagraph" class="p">第一页</div>
                    </div>
                </div>
                <div class="tab-item" data-type="NodeTabItem" data-node-id="tab2" data-tabs-hidden="true">
                    <div class="tab-item-info">
                        <div data-node-id="title2" data-type="NodeParagraph" class="p">Two</div>
                    </div>
                    <div class="tab-item-content">
                        <div data-node-id="p2" data-type="NodeParagraph" class="p">第二页</div>
                    </div>
                </div>
            </div>
            <div class="mindmap" data-type="NodeMindmap" data-node-id="mindmap">
                <div class="mindmap-view">脑图预览文字</div>
                <div data-node-id="mind-p" data-type="NodeParagraph" class="p">脑图子块</div>
            </div>
        </div>
    </div>`;

function bindTabClicks(protyle: HTMLElement) {
    const items = Array.from(protyle.querySelectorAll<HTMLElement>(".tab-item"));
    protyle.querySelectorAll<HTMLElement>(".tabs-tab").forEach((button) => {
        button.addEventListener("click", () => {
            const id = button.dataset.tabId;
            items.forEach((item) => {
                item.setAttribute("data-tabs-hidden", String(item.dataset.nodeId !== id));
            });
        });
    });
}

describe("原生标签页与容器块", () => {
    it("标签页容器和脑图容器的生成控件不算正文块", () => {
        const protyle = mountProtyle(TABS_PROTYLE);

        expect(isContentBlockElement(protyle.querySelector('[data-node-id="tabs"]') as Element, protyle)).toBe(false);
        expect(isContentBlockElement(protyle.querySelector('[data-node-id="tab1"]') as Element, protyle)).toBe(false);
        expect(isContentBlockElement(protyle.querySelector('[data-node-id="mindmap"]') as Element, protyle)).toBe(false);
        expect(isContentBlockElement(protyle.querySelector('[data-node-id="p1"]') as Element, protyle)).toBe(true);
        expect(isContentBlockElement(protyle.querySelector('[data-node-id="title1"]') as Element, protyle)).toBe(true);
    });

    it("识别并激活隐藏在未选中页签里的块", () => {
        const protyle = mountProtyle(TABS_PROTYLE);
        bindTabClicks(protyle);
        const hiddenBlock = protyle.querySelector('[data-node-id="p2"]') as HTMLElement;

        expect(isHiddenByTabs(hiddenBlock)).toBe(true);
        expect(revealHiddenTabAncestors(hiddenBlock)).toBe(true);
        expect(isHiddenByTabs(hiddenBlock)).toBe(false);
        expect(protyle.querySelector('[data-node-id="tab2"]')?.getAttribute("data-tabs-hidden")).toBe("false");
        expect(protyle.querySelector('[data-node-id="tab1"]')?.getAttribute("data-tabs-hidden")).toBe("true");
    });

    it("隐藏页签中的正文不产生 DOM 命中，切页签后恢复", () => {
        const protyle = mountProtyle(TABS_PROTYLE);
        bindTabClicks(protyle);

        expect(calculateDomHits(protyle, "第二页").map((hit) => hit.blockId)).toEqual([]);

        revealHiddenTabAncestors(protyle.querySelector('[data-node-id="p2"]') as HTMLElement);
        expect(calculateDomHits(protyle, "第二页").map((hit) => hit.blockId)).toEqual(["p2"]);
    });

    it("标签页导航按钮文字不产生额外命中", () => {
        const protyle = mountProtyle(TABS_PROTYLE);

        expect(calculateDomHits(protyle, "One").map((hit) => hit.blockId)).toEqual(["title1"]);
    });
});

describe("isDocumentTabProtyle", () => {
    function mount(html: string): HTMLElement {
        const root = document.createElement("div");
        root.innerHTML = html;
        document.body.appendChild(root);
        return root;
    }

    it("只接受中心页签面板本身", () => {
        const root = mount(`
            <div class="layout__center">
                <div data-type="wnd">
                    <div class="layout-tab-container fn__flex-1">
                        <div class="fn__flex-1 protyle">
                            <div class="protyle-content">
                                <div class="protyle-title">
                                    <div class="protyle-title__rich protyle">
                                        <div class="protyle-content"><div class="protyle-wysiwyg"></div></div>
                                    </div>
                                </div>
                                <div class="protyle-wysiwyg"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`);

        const tabProtyle = root.querySelector<HTMLElement>(".layout-tab-container > .protyle");
        const titleProtyle = root.querySelector<HTMLElement>(".protyle-title__rich");

        expect(isDocumentTabProtyle(tabProtyle)).toBe(true);
        expect(isDocumentTabProtyle(titleProtyle)).toBe(false);
    });

    it("排除停靠栏、全局搜索预览与反链浮窗中的编辑器", () => {
        const root = mount(`
            <div class="layout__dockb">
                <div class="layout-tab-container"><div class="fn__flex-1 protyle"></div></div>
            </div>
            <div class="layout__center">
                <div data-type="wnd">
                    <div class="layout-tab-container fn__flex-1">
                        <div class="fn__flex-1">
                            <div id="searchPreview" class="fn__flex-1 search__preview protyle"></div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="block__popover block__popover--backlinks">
                <div class="block__backlinks"><div class="protyle"></div></div>
            </div>`);

        const dockProtyle = root.querySelector<HTMLElement>(".layout__dockb .protyle");
        const searchProtyle = root.querySelector<HTMLElement>("#searchPreview");
        const popoverProtyle = root.querySelector<HTMLElement>(".block__popover .protyle");

        expect(isDocumentTabProtyle(dockProtyle)).toBe(false);
        expect(isDocumentTabProtyle(searchProtyle)).toBe(false);
        expect(isDocumentTabProtyle(popoverProtyle)).toBe(false);
    });
});
