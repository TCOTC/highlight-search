import { getDocRoots, isContentBlockElement } from "../block-dom";
import { findMatchSpans, normalizeSearchValue } from "../match-text";
import { collectOwnTextNodes, expandVirtualTableBlock } from "../visible-text";

/**
 * 扫描当前搜索范围的活 DOM，收集可见正文中已命中关键词的块 ID。
 * 用于补上 SQL 索引尚未跟上的刚编辑块，使结果列表与 DOM 高亮一致。
 */
export function collectLiveCandidateIds(
    scopeEl: Element,
    query: string,
    caseSensitive: boolean,
    wholeWord = false,
): string[] {
    const needle = normalizeSearchValue(query);
    if (!needle) return [];

    const docRoots = getDocRoots(scopeEl);
    if (docRoots.length === 0) return [];

    const ids: string[] = [];
    const seen = new Set<string>();

    for (const docRoot of docRoots) {
        for (const blockEl of docRoot.querySelectorAll("[data-node-id]")) {
            const blockId = blockEl.getAttribute("data-node-id");
            if (!blockId || seen.has(blockId)) continue;
            if (!isContentBlockElement(blockEl, scopeEl)) continue;
            if (
                blockEl.closest('[data-type="NodeBlockQueryEmbed"]') &&
                !blockEl.matches('[data-type="NodeBlockQueryEmbed"]')
            ) {
                continue;
            }
            if (blockEl.getAttribute("data-type") === "NodeBlockQueryEmbed") {
                continue;
            }

            const { text } = collectOwnTextNodes(expandVirtualTableBlock(blockEl));
            if (!text) continue;
            if (findMatchSpans(text, needle, caseSensitive, wholeWord).length === 0) {
                continue;
            }
            seen.add(blockId);
            ids.push(blockId);
        }
    }

    return ids;
}
