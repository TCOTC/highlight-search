import { beforeEach, describe, expect, it } from "vitest";
import { isDocumentTabProtyle } from "./block-dom";

function mount(html: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
}

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("isDocumentTabProtyle", () => {
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
