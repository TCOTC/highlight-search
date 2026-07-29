import { getDocRoot } from "../block-dom";
import { findMatchSpans, normalizeSearchValue } from "../match-text";
import { collectOwnTextNodes } from "../visible-text";

/**
 * 扫描当前编辑器活 DOM，收集可见正文中已命中关键词的块 ID。
 * 用于补上 SQL 索引尚未跟上的刚编辑块，使结果列表与 DOM 高亮一致。
 */
export function collectLiveCandidateIds(
    protyleEl: Element,
    query: string,
    caseSensitive: boolean,
    wholeWord = false,
): string[] {
    const needle = normalizeSearchValue(query);
    if (!needle) return [];

    const docRoot = getDocRoot(protyleEl);
    if (!docRoot) return [];

    const ids: string[] = [];
    const seen = new Set<string>();

    for (const blockEl of docRoot.querySelectorAll("[data-node-id]")) {
        const blockId = blockEl.getAttribute("data-node-id");
        if (!blockId || seen.has(blockId)) continue;
        if (
            blockEl.closest('[data-type="NodeBlockQueryEmbed"]') &&
            !blockEl.matches('[data-type="NodeBlockQueryEmbed"]')
        ) {
            continue;
        }
        if (blockEl.getAttribute("data-type") === "NodeBlockQueryEmbed") {
            continue;
        }

        const { text } = collectOwnTextNodes(blockEl);
        if (!text) continue;
        if (findMatchSpans(text, needle, caseSensitive, wholeWord).length === 0) {
            continue;
        }
        seen.add(blockId);
        ids.push(blockId);
    }

    return ids;
}
