import { getDocRoot } from "../block-dom";
import {
    findMatchSpans,
    normalizeSearchValue,
} from "../match-text";
import { collectOwnTextNodes } from "../visible-text";

/** DOM 内一处命中，带 blockId+occ 以便与 FindMatch 对齐 */
export interface DomHit {
    blockId: string;
    occ: number;
    range: Range;
}

/** 检查元素是否可见 */
function isElementVisible(element: Element | null): boolean {
    if (!element) return false;
    const htmlElement = element as HTMLElement;
    if (htmlElement.tagName?.toLowerCase() === "style") {
        return false;
    }
    let current: Element | null = element;
    while (current && current !== document.body) {
        if ((current as HTMLElement).classList?.contains("fn__none")) {
            return false;
        }
        current = current.parentElement;
    }
    if (typeof htmlElement.checkVisibility === "function") {
        return htmlElement.checkVisibility({
            visibilityProperty: true,
            opacityProperty: true,
        });
    }
    const style = window.getComputedStyle(htmlElement);
    if (style.display === "none" || style.visibility === "hidden") {
        return false;
    }
    return isElementVisible(htmlElement.parentElement);
}

function createRangeForSpan(
    span: { start: number; end: number },
    allTextNodes: Text[],
    nodeStarts: number[],
    incrLens: number[],
): Range | null {
    try {
        if (allTextNodes.length === 0) return null;

        const mapJoinedToNodeOffset = (
            joinedPos: number,
            preferEnd: boolean,
        ): { nodeIdx: number; offset: number } | null => {
            for (let i = 0; i < allTextNodes.length; i++) {
                const start = nodeStarts[i];
                const end = incrLens[i];
                if (joinedPos >= start && joinedPos < end) {
                    return { nodeIdx: i, offset: joinedPos - start };
                }
                if (joinedPos === end) {
                    // 落在节点末尾或其后分隔空格上
                    if (preferEnd || i === allTextNodes.length - 1) {
                        return { nodeIdx: i, offset: end - start };
                    }
                }
            }
            // 落在节点间插入的空格上：起点靠后一节点，终点靠前一节点
            for (let i = 0; i < allTextNodes.length; i++) {
                if (joinedPos < nodeStarts[i]) {
                    return preferEnd && i > 0
                        ? {
                              nodeIdx: i - 1,
                              offset: incrLens[i - 1] - nodeStarts[i - 1],
                          }
                        : { nodeIdx: i, offset: 0 };
                }
            }
            const last = allTextNodes.length - 1;
            return {
                nodeIdx: last,
                offset: incrLens[last] - nodeStarts[last],
            };
        };

        const startMapped = mapJoinedToNodeOffset(span.start, false);
        const endMapped = mapJoinedToNodeOffset(span.end, true);
        if (!startMapped || !endMapped) return null;

        const startNode = allTextNodes[startMapped.nodeIdx];
        const endNode = allTextNodes[endMapped.nodeIdx];
        const startNodeLen = startNode.textContent?.length ?? 0;
        const endNodeLen = endNode.textContent?.length ?? 0;
        if (startMapped.offset < 0 || startMapped.offset > startNodeLen) return null;
        if (endMapped.offset < 0 || endMapped.offset > endNodeLen) return null;

        const range = document.createRange();
        range.setStart(startNode, startMapped.offset);
        range.setEnd(endNode, endMapped.offset);

        const startEl = startNode.parentElement;
        const endEl = endNode.parentElement;
        if (
            startEl &&
            endEl &&
            isElementVisible(startEl) &&
            isElementVisible(endEl)
        ) {
            return range;
        }
    } catch (error) {
        console.error("Error setting range in node:", error);
    }
    return null;
}

/**
 * 按块扫描当前 DOM，生成带 blockId+occ 的命中列表。
 */
export function calculateDomHits(
    protyleEl: Element,
    value: string,
    caseSensitive = false,
    wholeWord = false,
): DomHit[] {
    const needle = normalizeSearchValue(value);
    if (!needle) return [];

    const docRoot = getDocRoot(protyleEl);
    if (!docRoot) return [];

    const hits: DomHit[] = [];

    const blockEls = docRoot.querySelectorAll("[data-node-id]");
    for (const blockEl of blockEls) {
        const blockId = blockEl.getAttribute("data-node-id");
        if (!blockId) continue;
        // 跳过 embed 内的块，避免与主文档重复
        if (blockEl.closest('[data-type="NodeBlockQueryEmbed"]') &&
            !blockEl.matches('[data-type="NodeBlockQueryEmbed"]')) {
            // embed 内部子块仍可能要搜？计划是当前文档；embed 内容属其它文档，跳过
            continue;
        }
        if (blockEl.getAttribute("data-type") === "NodeBlockQueryEmbed") {
            continue;
        }

        const { nodes, nodeStarts, incrLens, text } = collectOwnTextNodes(blockEl);
        if (!text) continue;

        const spans = findMatchSpans(text, needle, caseSensitive, wholeWord);
        spans.forEach((span, occ) => {
            const range = createRangeForSpan(span, nodes, nodeStarts, incrLens);
            if (range) {
                hits.push({ blockId, occ, range });
            }
        });
    }

    return hits;
}
