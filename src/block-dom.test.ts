import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    getDocRoot,
    getDocRoots,
    getDocContentElement,
    getDocTitleElements,
    findBlockElement,
    isBacklinkPopoverScope,
    isContentBlockElement,
    isLiteFragmentProtyle,
    isOpenPopover,
    isPartialDocumentScope,
    isSearchableProtyle,
    isHiddenByTabs,
    revealHiddenTabAncestors,
} from "./block-dom";
import { calculateDomHits } from "./highlight/dom-hits";
import { collectTitleTextNodes } from "./visible-text";

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

const TITLE_PROTYLE = `
    <div class="protyle-content">
        <div class="protyle-top">
            <div class="protyle-title" data-node-id="doc-id" data-render="true"><div class="protyle-title__icon"><svg><use xlink:href="#iconFile"></use></svg></div><div class="protyle-title__rich protyle protyle-lite-fragment"><div class="protyle-content"><div class="protyle-wysiwyg"><div data-node-id="temp-title-p" data-type="NodeParagraph" class="p"><div class="protyle-title__input" contenteditable="true">文档 标题 关键词</div><div class="protyle-attr"><div class="protyle-attr--bookmark">书签 关键词</div></div></div></div></div></div></div>
        </div>
        <div class="protyle-wysiwyg">
            <div data-node-id="body-p" data-type="NodeParagraph" class="p">
                <div contenteditable="true">正文 关键词</div>
            </div>
        </div>
    </div>`;

describe("文档标题", () => {
    it("读取富文本标题的文本，排除块属性", () => {
        const protyle = mountProtyle(TITLE_PROTYLE);
        const titleEl = getDocTitleElements(protyle)[0];

        expect(titleEl.getAttribute("data-node-id")).toBe("doc-id");
        expect(collectTitleTextNodes(titleEl).text).toBe("文档 标题 关键词");
    });

    it("标题命中归到文档块 ID，且不重复计临时块", () => {
        const protyle = mountProtyle(TITLE_PROTYLE);

        const blockIds = calculateDomHits(protyle, "关键词").map((hit) => hit.blockId);

        expect(blockIds).toEqual(["doc-id", "body-p"]);
    });

    it("隐藏标题不产生命中", () => {
        const protyle = mountProtyle(TITLE_PROTYLE);
        (protyle.querySelector(".protyle-title") as HTMLElement).classList.add("fn__none");

        expect(calculateDomHits(protyle, "标题")).toEqual([]);
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

describe("isSearchableProtyle", () => {
    function mount(html: string): HTMLElement {
        const root = document.createElement("div");
        root.innerHTML = html;
        document.body.appendChild(root);
        return root;
    }

    it("接受页签正文、块浮窗与全局搜索预览", () => {
        const root = mount(`
            <div class="layout__center">
                <div data-type="wnd">
                    <div class="layout-tab-container fn__flex-1">
                        <div id="tab" class="fn__flex-1 protyle"></div>
                    </div>
                </div>
            </div>
            <div class="layout__dockb">
                <div class="layout-tab-container"><div id="dock" class="fn__flex-1 protyle"></div></div>
            </div>
            <div class="block__popover block__popover--open">
                <div class="block__content"><div id="popover" class="block__edit fn__flex-1 protyle"></div></div>
            </div>
            <div id="search-preview" class="fn__flex-1 search__preview protyle"></div>`);

        expect(isSearchableProtyle(root.querySelector<HTMLElement>("#tab") as HTMLElement)).toBe(true);
        expect(isSearchableProtyle(root.querySelector<HTMLElement>("#dock") as HTMLElement)).toBe(true);
        expect(isSearchableProtyle(root.querySelector<HTMLElement>("#popover") as HTMLElement)).toBe(true);
        expect(isSearchableProtyle(root.querySelector<HTMLElement>("#search-preview") as HTMLElement)).toBe(true);
    });

    it("排除片段编辑器、嵌套编辑器、隐藏编辑器与已移除元素", () => {
        const root = mount(`
            <div id="title-fragment" class="protyle-title__rich protyle protyle-lite-fragment" data-protyle-lite="true"></div>
            <div id="lite" class="table__cell-editor protyle" data-protyle-lite="true"></div>
            <div class="protyle"><div id="nested" class="protyle"></div></div>
            <div class="layout__tab-container fn__none"><div id="hidden" class="protyle"></div></div>`);
        const detached = document.createElement("div");
        detached.className = "protyle";

        expect(isSearchableProtyle(root.querySelector<HTMLElement>("#title-fragment") as HTMLElement)).toBe(false);
        expect(isSearchableProtyle(root.querySelector<HTMLElement>("#lite") as HTMLElement)).toBe(false);
        expect(isSearchableProtyle(root.querySelector<HTMLElement>("#nested") as HTMLElement)).toBe(false);
        expect(isSearchableProtyle(root.querySelector<HTMLElement>("#hidden") as HTMLElement)).toBe(false);
        expect(isSearchableProtyle(detached)).toBe(false);
    });
});

describe("isLiteFragmentProtyle", () => {
    it("按 data-protyle-lite 与片段宿主类名识别", () => {
        const root = document.createElement("div");
        root.innerHTML = `
            <div id="lite" class="protyle" data-protyle-lite="true"></div>
            <div id="fragment" class="protyle protyle-lite-fragment"></div>
            <div id="normal" class="protyle" data-protyle-lite="false"></div>`;
        document.body.appendChild(root);

        expect(isLiteFragmentProtyle(root.querySelector<HTMLElement>("#lite") as HTMLElement)).toBe(true);
        expect(isLiteFragmentProtyle(root.querySelector<HTMLElement>("#fragment") as HTMLElement)).toBe(true);
        expect(isLiteFragmentProtyle(root.querySelector<HTMLElement>("#normal") as HTMLElement)).toBe(false);
    });
});

describe("isOpenPopover", () => {
    function mount(html: string): HTMLElement {
        const root = document.createElement("div");
        root.innerHTML = html;
        document.body.appendChild(root);
        return root;
    }

    it("只认已打开且未钉住的浮窗", () => {
        const root = mount(`
            <div id="open" class="block__popover block__popover--open"></div>
            <div id="loading" class="block__popover"></div>
            <div id="pinned" class="block__popover block__popover--open" data-pin="true"></div>`);

        expect(isOpenPopover(root.querySelector<HTMLElement>("#open") as HTMLElement)).toBe(true);
        expect(isOpenPopover(root.querySelector<HTMLElement>("#loading") as HTMLElement)).toBe(false);
        expect(isOpenPopover(root.querySelector<HTMLElement>("#pinned") as HTMLElement)).toBe(false);
    });
});

describe("反链浮窗作为整体范围", () => {
    const BACKLINK_POPOVER = `
        <div class="block__popover block__popover--backlinks block__popover--open">
            <div class="block__icons"></div>
            <div class="block__content">
                <div class="block__backlinks">
                    <div data-defid="a">
                        <div class="protyle">
                            <div class="protyle-content">
                                <div class="protyle-wysiwyg">
                                    <div data-node-id="ctx-a" data-type="NodeParagraph" class="p">
                                        <div contenteditable="true">第一处 关键词</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div data-defid="b">
                        <div class="protyle">
                            <div class="protyle-content">
                                <div class="protyle-wysiwyg">
                                    <div data-node-id="ctx-b" data-type="NodeParagraph" class="p">
                                        <div contenteditable="true">第二处 关键词</div>
                                    </div>
                                    <div data-node-id="ctx-title" data-type="NodeParagraph" class="p">
                                        <div class="protyle-title__rich protyle protyle-lite-fragment">
                                            <div class="protyle-content">
                                                <div class="protyle-wysiwyg">
                                                    <div data-node-id="fragment-p" data-type="NodeParagraph" class="p">
                                                        <div contenteditable="true">片段 关键词</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;

    function mount(html: string): HTMLElement {
        const root = document.createElement("div");
        root.innerHTML = html;
        document.body.appendChild(root);
        return root;
    }

    it("识别反链浮窗范围", () => {
        const root = mount(BACKLINK_POPOVER);
        const popover = root.querySelector<HTMLElement>(".block__popover--backlinks") as HTMLElement;
        const itemProtyle = root.querySelector<HTMLElement>(".block__backlinks .protyle") as HTMLElement;

        expect(isBacklinkPopoverScope(popover)).toBe(true);
        expect(isBacklinkPopoverScope(itemProtyle)).toBe(true);
        expect(isBacklinkPopoverScope(root)).toBe(false);
    });

    it("扫描浮窗内所有反链条目的正文", () => {
        const root = mount(BACKLINK_POPOVER);
        const popover = root.querySelector<HTMLElement>(".block__popover--backlinks") as HTMLElement;

        expect(getDocRoots(popover)).toHaveLength(2);
        expect(calculateDomHits(popover, "关键词").map((hit) => hit.blockId).sort())
            .toEqual(["ctx-a", "ctx-b"]);
        expect(findBlockElement(popover, "ctx-b")?.textContent).toContain("第二处");
    });

    it("排除浮窗内的嵌套片段编辑器", () => {
        const root = mount(BACKLINK_POPOVER);
        const popover = root.querySelector<HTMLElement>(".block__popover--backlinks") as HTMLElement;

        expect(findBlockElement(popover, "fragment-p")).toBeNull();
        expect(calculateDomHits(popover, "片段")).toEqual([]);
    });

    it("可滚动区取浮窗自己的内容区", () => {
        const root = mount(BACKLINK_POPOVER);
        const popover = root.querySelector<HTMLElement>(".block__popover--backlinks") as HTMLElement;

        expect(getDocContentElement(popover)?.classList.contains("block__content")).toBe(true);
    });
});

describe("全局搜索预览范围", () => {
    const SEARCH_PANEL = `
        <div class="layout__center">
            <div class="layout-tab-container fn__flex-1">
                <div class="fn__flex-1" data-id="search-tab">
                    <div class="search__layout">
                        <div id="searchPreview" class="fn__flex-1 search__preview protyle">
                            <div class="protyle-content">
                                <div class="protyle-wysiwyg">
                                    <div data-node-id="preview-p" data-type="NodeParagraph" class="p">
                                        <div contenteditable="true">预览 关键词</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div id="searchUnRefPreview" class="fn__flex-1 search__preview protyle fn__none"></div>
                    </div>
                </div>
            </div>
        </div>`;

    function mount(html: string): HTMLElement {
        const root = document.createElement("div");
        root.innerHTML = html;
        document.body.appendChild(root);
        return root;
    }

    it("识别搜索结果预览编辑器", () => {
        const root = mount(SEARCH_PANEL);
        const preview = root.querySelector<HTMLElement>("#searchPreview") as HTMLElement;

        expect(isSearchableProtyle(preview)).toBe(true);
        expect(isPartialDocumentScope(preview)).toBe(true);
        expect(isSearchableProtyle(root)).toBe(false);
    });

    it("按预览 DOM 扫描正文", () => {
        const root = mount(SEARCH_PANEL);
        const preview = root.querySelector<HTMLElement>("#searchPreview") as HTMLElement;

        expect(calculateDomHits(preview, "关键词").map((hit) => hit.blockId)).toEqual(["preview-p"]);
        expect(getDocContentElement(preview)?.classList.contains("protyle-content")).toBe(true);
    });

    it("预览与浮窗都按部分上下文搜索，文档页签不是", () => {
        const root = mount(`
            ${SEARCH_PANEL}
            <div class="block__popover block__popover--open"><div class="block__edit protyle"></div></div>
            <div class="layout__center">
                <div class="layout-tab-container"><div id="doc-protyle" class="protyle"></div></div>
            </div>`);

        expect(isPartialDocumentScope(root.querySelector<HTMLElement>("#searchPreview") as HTMLElement)).toBe(true);
        expect(isPartialDocumentScope(root.querySelector<HTMLElement>(".block__edit") as HTMLElement)).toBe(true);
        expect(isPartialDocumentScope(root.querySelector<HTMLElement>("#doc-protyle") as HTMLElement)).toBe(false);
    });
});
