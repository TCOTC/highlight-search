import { beforeEach, describe, expect, it } from "vitest";
import { collectLiveCandidateIds } from "./live-candidates";

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

describe("collectLiveCandidateIds", () => {
    it("不把标签页与脑图容器生成的控件文字计入候选", () => {
        const protyle = mountProtyle(`
            <div class="protyle-content">
                <div class="protyle-wysiwyg">
                    <div class="tabs" data-type="NodeTabs" data-node-id="tabs">
                        <div class="tabs-header">
                            <div class="tabs-list">
                                <button class="tabs-tab" data-tab-id="tab1">目标</button>
                            </div>
                        </div>
                        <div class="tab-item" data-type="NodeTabItem" data-node-id="tab1">
                            <div class="tab-item-info">
                                <div data-node-id="title1" data-type="NodeParagraph" class="p">目标标题</div>
                            </div>
                            <div class="tab-item-content">
                                <div data-node-id="p1" data-type="NodeParagraph" class="p">正文</div>
                            </div>
                        </div>
                    </div>
                    <div class="mindmap" data-type="NodeMindmap" data-node-id="mindmap">
                        <div class="mindmap-view">目标脑图</div>
                        <div data-node-id="mind-p" data-type="NodeParagraph" class="p">节点正文</div>
                    </div>
                    <div class="callout" data-type="NodeCallout" data-node-id="callout">
                        <div class="callout-info"><span class="callout-title">目标提示</span></div>
                        <div class="callout-content">
                            <div data-node-id="callout-p" data-type="NodeParagraph" class="p">正文</div>
                        </div>
                    </div>
                </div>
            </div>
        `);

        expect(collectLiveCandidateIds(protyle, "目标", false)).toEqual(["title1", "callout"]);
    });

    it("不扫描文档名富文本等嵌套 Protyle 的临时块", () => {
        const protyle = mountProtyle(`
            <div class="protyle-content">
                <div class="protyle-top">
                    <div class="protyle-title">
                        <div class="protyle-title__rich protyle protyle-lite-fragment">
                            <div class="protyle-content">
                                <div class="protyle-wysiwyg">
                                    <div data-node-id="title-p" data-type="NodeParagraph" class="p">目标标题</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="protyle-wysiwyg">
                    <div data-node-id="body-p" data-type="NodeParagraph" class="p">目标正文</div>
                </div>
            </div>
        `);

        expect(collectLiveCandidateIds(protyle, "目标", false)).toEqual(["body-p"]);
    });
});
