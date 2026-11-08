import { getDocTitleElements, isHiddenByFnNone } from "../block-dom";
import type { FindMatch } from "../find-match";
import { findMatchSpans, makeSnippetFromSpan } from "../match-text";
import { collectTitleTextNodes } from "../visible-text";

/**
 * 文档标题的匹配项。
 * 文档块不是叶子正文块，块检索不会把它当候选，这里直接读标题 DOM 文本。
 * 命中归到标题元素的 `data-node-id`（文档块 ID），与 DOM 高亮一致。
 */
export function buildTitleMatches(
    scopeEl: Element,
    needle: string,
    caseSensitive: boolean,
    wholeWord: boolean,
): FindMatch[] {
    const matches: FindMatch[] = [];
    const done = new Set<string>();

    for (const titleEl of getDocTitleElements(scopeEl)) {
        // 聚焦缩放等隐藏标题时不高亮，结果列表也不能计数
        if (isHiddenByFnNone(titleEl)) continue;
        const blockId = titleEl.getAttribute("data-node-id");
        if (!blockId || done.has(blockId)) continue;
        const { text } = collectTitleTextNodes(titleEl);
        if (!text) continue;

        const spans = findMatchSpans(text, needle, caseSensitive, wholeWord);
        if (spans.length === 0) continue;
        done.add(blockId);

        spans.forEach((span, occ) => {
            const snippet = makeSnippetFromSpan(text, span);
            matches.push({
                blockId,
                occ,
                snippet: snippet.text,
                snippetMatches: [{ start: snippet.matchStart, end: snippet.matchEnd }],
            });
        });
    }

    return matches;
}
