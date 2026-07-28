import { describe, expect, it } from "vitest";
import { buildDocOrderIndexFromHtml } from "./doc-order";

/** 用户反馈的嵌套列表片段：Spring 在 Express 之前 */
const NESTED_LIST_DOM =
    `<div data-subtype="u" data-node-id="20210104091228-tue1zbn" data-type="NodeList" class="list">` +
    `<div data-marker="*" data-subtype="u" data-node-id="20210104091228-ao01ihn" data-type="NodeListItem" class="li">` +
    `<div data-node-id="20210104091228-khhcxxb" data-type="NodeParagraph" class="p"><div contenteditable="true">Java</div></div>` +
    `<div data-subtype="u" data-node-id="20210104091228-2tvase5" data-type="NodeList" class="list">` +
    `<div data-marker="*" data-subtype="u" data-node-id="20210104091228-f1fuuw8" data-type="NodeListItem" class="li">` +
    `<div data-node-id="20210201202130-qygmjtz" data-type="NodeParagraph" class="p"><div contenteditable="true">Spring</div></div>` +
    `</div></div></div>` +
    `<div data-marker="*" data-subtype="u" data-node-id="20210104091228-7flk3zm" data-type="NodeListItem" class="li">` +
    `<div data-node-id="20210104091228-uf9qzs2" data-type="NodeParagraph" class="p"><div contenteditable="true">Node.js</div></div>` +
    `<div data-subtype="u" data-node-id="20210104091228-eqn6zno" data-type="NodeList" class="list">` +
    `<div data-marker="*" data-subtype="u" data-node-id="20210104091228-vntkz6f" data-type="NodeListItem" class="li">` +
    `<div data-node-id="20210201202130-c8xufv4" data-type="NodeParagraph" class="p"><div contenteditable="true">Express</div></div>` +
    `</div></div></div></div>`;

describe("buildDocOrderIndexFromHtml", () => {
    it("嵌套列表中 Spring 段落排在 Express 之前", () => {
        const index = buildDocOrderIndexFromHtml(NESTED_LIST_DOM);
        const spring = index.get("20210201202130-qygmjtz");
        const express = index.get("20210201202130-c8xufv4");
        expect(spring).toBeDefined();
        expect(express).toBeDefined();
        expect(spring!).toBeLessThan(express!);
    });

    it("仅对 neededIds 建索引时仍保持相对阅读序", () => {
        const needed = new Set(["20210201202130-c8xufv4", "20210201202130-qygmjtz"]);
        const index = buildDocOrderIndexFromHtml(NESTED_LIST_DOM, needed);
        expect(index.get("20210201202130-qygmjtz")!).toBeLessThan(
            index.get("20210201202130-c8xufv4")!,
        );
        expect(index.has("20210104091228-khhcxxb")).toBe(false);
    });

    it("空 HTML 返回空 Map", () => {
        expect(buildDocOrderIndexFromHtml("").size).toBe(0);
    });
});
