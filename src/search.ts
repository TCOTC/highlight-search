import type { FindMatch } from "./block-search";
import {
    findMatchSpans,
    normalizeSearchValue,
} from "./match-text";
import { isDebugEnabled } from "./case-settings";
import { getDocRoot } from "./block-dom";
import {
    collectOwnTextNodes,
    dataContentTextFromBlock,
    isDiagramContentBlock,
} from "./visible-text";

/** 可滚动的内容容器 */
function getDocContent(protyleEl: Element): HTMLElement | null {
    return protyleEl.querySelector(":is(.protyle-content:not(.fn__none), .protyle-preview:not(.fn__none))");
}

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

/** @deprecated 兼容旧调用：仅返回 Range[] */
export function calculateSearchResults(protyleEl: Element, value: string): Range[] {
    return calculateDomHits(protyleEl, value).map((h) => h.range);
}

const HIGHLIGHT_STYLE_ID = "jchs-highlight-style";
const HIGHLIGHT_STYLE_CSS = `
::highlight(search-results) {
    background-color: rgb(235 235 5);
    color: rgb(0, 0, 0);
}
::highlight(search-focus) {
    background-color: rgb(255, 150, 50);
    color: rgb(0, 0, 0);
}`;

const BLOCK_FOCUS_ATTR = "data-jchs-block-focus";
let blockFocusEl: HTMLElement | null = null;
let blockFocusTimer: ReturnType<typeof setTimeout> | null = null;

/** 无法词级高亮时，给块元素闪一下焦点样式（空值属性 + CSS） */
export function flashBlockFocus(el: HTMLElement, durationMs = 1000) {
    clearBlockFocus();
    blockFocusEl = el;
    el.setAttribute(BLOCK_FOCUS_ATTR, "");
    blockFocusTimer = setTimeout(() => {
        clearBlockFocus();
    }, durationMs);
}

export function clearBlockFocus() {
    if (blockFocusTimer != null) {
        clearTimeout(blockFocusTimer);
        blockFocusTimer = null;
    }
    if (blockFocusEl?.hasAttribute(BLOCK_FOCUS_ATTR)) {
        blockFocusEl.removeAttribute(BLOCK_FOCUS_ATTR);
    }
    blockFocusEl = null;
}

const keywordSources = new Set<object>();
const resultRangesBySource = new Map<object, Range[]>();
const focusRangeBySource = new Map<object, Range>();
/** 各搜索框当前 DOM 命中（带 blockId+occ） */
const domHitsBySource = new Map<object, DomHit[]>();

function ensureHighlightStyle() {
    if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = HIGHLIGHT_STYLE_CSS;
    document.head.appendChild(style);
}

function removeHighlightStyle() {
    document.getElementById(HIGHLIGHT_STYLE_ID)?.remove();
}

function syncHighlightStyle() {
    if (keywordSources.size > 0) {
        ensureHighlightStyle();
    } else {
        removeHighlightStyle();
    }
}

export function setHasSearchKeyword(source: object, hasKeyword: boolean) {
    if (hasKeyword) {
        keywordSources.add(source);
    } else {
        keywordSources.delete(source);
    }
    syncHighlightStyle();
}

function rebuildSearchHighlights() {
    const all: Range[] = [];
    for (const ranges of resultRangesBySource.values()) {
        all.push(...ranges);
    }
    if (all.length === 0) {
        CSS.highlights.delete("search-results");
        return;
    }
    ensureHighlightStyle();
    CSS.highlights.set("search-results", new Highlight(...all));
}

function rebuildFocusHighlights() {
    const all = [...focusRangeBySource.values()];
    if (all.length === 0) {
        CSS.highlights.delete("search-focus");
        return;
    }
    ensureHighlightStyle();
    CSS.highlights.set("search-focus", new Highlight(...all));
}

export function clearHighlight(source: object) {
    resultRangesBySource.delete(source);
    focusRangeBySource.delete(source);
    domHitsBySource.delete(source);
    clearBlockFocus();
    rebuildSearchHighlights();
    rebuildFocusHighlights();
    syncHighlightStyle();
}

export function applySearchHighlights(source: object, ranges: Range[]) {
    if (ranges.length === 0) {
        resultRangesBySource.delete(source);
        focusRangeBySource.delete(source);
    } else {
        resultRangesBySource.set(source, ranges);
    }
    rebuildSearchHighlights();
    rebuildFocusHighlights();
    syncHighlightStyle();
}

export function applyFocusHighlight(source: object, range: Range) {
    focusRangeBySource.set(source, range);
    rebuildFocusHighlights();
}

/** 计算 DOM 命中并登记高亮，返回 DomHit[] */
export function highlightDomHits(
    source: object,
    protyleEl: Element,
    value: string,
    caseSensitive = false,
    wholeWord = false,
): DomHit[] {
    if (!normalizeSearchValue(value)) {
        clearHighlight(source);
        return [];
    }
    const hits = calculateDomHits(protyleEl, value, caseSensitive, wholeWord);
    domHitsBySource.set(source, hits);
    applySearchHighlights(source, hits.map((h) => h.range));
    return hits;
}

/** 兼容旧接口 */
export function highlightHitResult(source: object, protyleEl: Element, value: string): Range[] {
    return highlightDomHits(source, protyleEl, value).map((h) => h.range);
}

export function getDomHits(source: object): DomHit[] {
    return domHitsBySource.get(source) ?? [];
}

/**
 * 在当前 DOM 命中中查找与 FindMatch 对齐的项。
 * 1) 精确 occ 且 Range 文本与 snippet 命中一致（若有）
 * 2) 按 snippet 命中文本对齐 Range（避免 occ 回退指错元素）
 * 3) 最后才按 occ 距离回退
 */
export function resolveDomHit(source: object, match: FindMatch): DomHit | undefined {
    const hits = getDomHits(source);
    const sameBlock = hits.filter((h) => h.blockId === match.blockId);
    if (sameBlock.length === 0) return undefined;

    const firstSpan = match.snippetMatches?.[0];
    const needle =
        match.snippet && firstSpan
            ? match.snippet.slice(firstSpan.start, firstSpan.end)
            : "";

    const rangeText = (h: DomHit) => h.range.toString();
    const textMatchesNeedle = (h: DomHit) => {
        if (!needle) return true;
        const t = rangeText(h);
        return t === needle || t.includes(needle) || needle.includes(t);
    };

    const exactOcc = sameBlock.find((h) => h.occ === match.occ);
    if (exactOcc && textMatchesNeedle(exactOcc)) {
        return exactOcc;
    }

    if (needle) {
        const exactText = sameBlock.filter((h) => rangeText(h) === needle);
        if (exactText.length === 1) return exactText[0];
        if (exactText.length > 1) {
            return (
                exactText.find((h) => h.occ === match.occ) ??
                exactText[0]
            );
        }
        const partial = sameBlock.filter(textMatchesNeedle);
        if (partial.length === 1) return partial[0];
        if (partial.length > 1) {
            return (
                partial.find((h) => h.occ === match.occ) ??
                partial.reduce((best, h) =>
                    Math.abs(h.occ - match.occ) < Math.abs(best.occ - match.occ) ? h : best,
                )
            );
        }
    }

    return sameBlock.reduce((best, h) =>
        Math.abs(h.occ - match.occ) < Math.abs(best.occ - match.occ) ? h : best,
    );
}

export function findScrollContainers(element: Element): HTMLElement[] {
    const containers: HTMLElement[] = [];
    let current: Element | null = element;
    while (current && current !== document.body) {
        const htmlElement = current as HTMLElement;
        const overflowY = window.getComputedStyle(htmlElement).overflowY;
        const overflowX = window.getComputedStyle(htmlElement).overflowX;
        const canScrollY =
            (overflowY === "auto" || overflowY === "scroll") &&
            htmlElement.scrollHeight > htmlElement.clientHeight;
        const canScrollX =
            (overflowX === "auto" || overflowX === "scroll") &&
            htmlElement.scrollWidth > htmlElement.clientWidth;
        if (canScrollY || canScrollX) {
            containers.push(htmlElement);
        }
        current = current.parentElement;
    }
    return containers;
}

export function scrollContainerToRange(range: Range, container: HTMLElement) {
    const rangeRect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const containerStyle = window.getComputedStyle(container);
    const rangeCenterX = (rangeRect.left + rangeRect.right) / 2;
    const overflowY = containerStyle.overflowY;
    const overflowX = containerStyle.overflowX;
    const canScrollY =
        (overflowY === "auto" || overflowY === "scroll") &&
        container.scrollHeight > container.clientHeight;
    const canScrollX =
        (overflowX === "auto" || overflowX === "scroll") &&
        container.scrollWidth > container.clientWidth;
    if (canScrollY) {
        const rangeCenterY = (rangeRect.top + rangeRect.bottom) / 2;
        const rangeCenterYInContent = rangeCenterY - containerRect.top + container.scrollTop;
        const targetScrollTop = rangeCenterYInContent - container.clientHeight / 2;
        const maxScrollTop = container.scrollHeight - container.clientHeight;
        container.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
    }
    if (canScrollX) {
        const rangeCenterXInContent = rangeCenterX - containerRect.left + container.scrollLeft;
        const targetScrollLeft = rangeCenterXInContent - container.clientWidth / 2;
        const maxScrollLeft = container.scrollWidth - container.clientWidth;
        container.scrollLeft = Math.max(0, Math.min(targetScrollLeft, maxScrollLeft));
    }
}

export function scrollIntoRanges(
    source: object,
    protyleEl: Element,
    ranges: Range[],
    index: number,
    scroll: boolean = true,
) {
    if (!ranges || ranges.length === 0) return;
    const range = ranges[index];
    if (!range) return;
    scrollToRange(source, protyleEl, range, scroll);
}

export function scrollToRange(
    source: object,
    protyleEl: Element,
    range: Range,
    scroll: boolean = true,
) {
    if (scroll) {
        const commonAncestor = range.commonAncestorContainer;
        const ancestorElement =
            commonAncestor.nodeType === Node.TEXT_NODE
                ? commonAncestor.parentElement
                : (commonAncestor as Element);
        if (ancestorElement) {
            const scrollContainers = findScrollContainers(ancestorElement);
            scrollContainers.forEach((container) => {
                scrollContainerToRange(range, container);
            });
            if (scrollContainers.length === 0) {
                const docContentElement = getDocContent(protyleEl);
                if (docContentElement) {
                    scrollContainerToRange(range, docContentElement);
                }
            }
        }
    }
    applyFocusHighlight(source, range);
}

/** 将 FindMatch 映射到 DOM Range 并滚动 / 设焦点高亮 */
export function focusFindMatch(
    source: object,
    protyleEl: Element,
    match: FindMatch,
    scroll: boolean = true,
): boolean {
    const hit = resolveDomHit(source, match);
    if (!hit) {
        if (isDebugEnabled()) {
            console.log("[jchs focus] 无 DomHit，无法词级滚动", {
                matchBlockId: match.blockId,
                matchOcc: match.occ,
                snippet: match.snippet?.slice(0, 80),
                domHitCount: getDomHits(source).length,
            });
        }
        return false;
    }

    if (isDebugEnabled()) {
        const range = hit.range;
        const startNode = range.startContainer;
        const startEl =
            startNode.nodeType === Node.TEXT_NODE
                ? (startNode as Text).parentElement
                : (startNode as Element);
        const endNode = range.endContainer;
        const endEl =
            endNode.nodeType === Node.TEXT_NODE
                ? (endNode as Text).parentElement
                : (endNode as Element);
        const blockEl = startEl?.closest?.("[data-node-id]") as HTMLElement | null;
        const sameBlockHits = getDomHits(source).filter((h) => h.blockId === match.blockId);
        console.log("[jchs focus] 滚动到搜索结果", {
            matchBlockId: match.blockId,
            matchOcc: match.occ,
            matchSnippet: match.snippet?.slice(0, 120),
            hitBlockId: hit.blockId,
            hitOcc: hit.occ,
            occFallback: hit.occ !== match.occ,
            rangeText: range.toString().slice(0, 120),
            // 同块在 DOM 里实际扫到几处（图表常远少于 data-content 的 Match occ）
            sameBlockDomHitCount: sameBlockHits.length,
            sameBlockDomHits: sameBlockHits.map((h) => ({
                occ: h.occ,
                text: h.range.toString().slice(0, 80),
                startEl:
                    h.range.startContainer.nodeType === Node.TEXT_NODE
                        ? (h.range.startContainer as Text).parentElement
                        : (h.range.startContainer as Element),
            })),
            startEl,
            endEl,
            blockEl,
            range,
        });
        if (blockEl && isDiagramContentBlock(blockEl)) {
            const fromContent = dataContentTextFromBlock(blockEl);
            const fromDom = collectOwnTextNodes(blockEl).text;
            console.log("[jchs focus] 图表块文本对照（Match 用 content，高亮用 DOM）", {
                blockId: match.blockId,
                contentLen: fromContent.length,
                contentPreview: fromContent.slice(0, 160),
                domTextLen: fromDom.length,
                domTextPreview: fromDom.slice(0, 160),
                contentOccHint: match.occ,
                domHitOccs: sameBlockHits.map((h) => h.occ),
            });
        }
    }

    scrollToRange(source, protyleEl, hit.range, scroll);
    return true;
}

export { normalizeSearchValue } from "./match-text";
