import { getCaseMode } from "./case-settings";
import type { FindMatch } from "./block-search";
import {
    findMatchSpans,
    normalizeSearchValue,
    resolveCaseSensitive,
    type CaseSensitiveMode,
} from "./match-text";

/** 文档正文根节点（wysiwyg / 预览） */
function getDocRoot(protyleEl: Element): HTMLElement | null {
    return protyleEl.querySelector(":is(.protyle-content:not(.fn__none) .protyle-wysiwyg, .protyle-preview:not(.fn__none) .b3-typography)");
}

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

/**
 * 收集块元素自身的文本节点（排除嵌套 [data-node-id]，避免父子双重计数）
 */
function collectOwnTextNodes(blockEl: Element): { nodes: Text[]; incrLens: number[]; text: string } {
    const nodes: Text[] = [];
    const incrLens: number[] = [];
    let curLen = 0;
    const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = (node as Text).parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            // 排除样式、块属性区与辅助 MathML，只保留可见正文
            if (parent.closest("style, script, .protyle-attr, .katex-mathml")) {
                return NodeFilter.FILTER_REJECT;
            }
            if (parent.closest('[aria-hidden="true"]')) {
                return NodeFilter.FILTER_REJECT;
            }
            // 文本落在嵌套块内则跳过（自身块根上的 text 仍接受）
            const nestedBlock = parent.closest("[data-node-id]");
            if (nestedBlock && nestedBlock !== blockEl) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    let current = walker.nextNode();
    while (current) {
        nodes.push(current as Text);
        curLen += current.textContent?.length ?? 0;
        incrLens.push(curLen);
        current = walker.nextNode();
    }
    return {
        nodes,
        incrLens,
        text: nodes.map((n) => n.textContent ?? "").join(""),
    };
}

function createRangeForSpan(
    span: { start: number; end: number },
    allTextNodes: Text[],
    incrLens: number[],
): Range | null {
    try {
        if (allTextNodes.length === 0) return null;
        let startNodeIdx = 0;
        while (startNodeIdx < allTextNodes.length - 1 && incrLens[startNodeIdx] <= span.start) {
            startNodeIdx++;
        }
        const startNode = allTextNodes[startNodeIdx];
        const startOffset = span.start - (startNodeIdx > 0 ? incrLens[startNodeIdx - 1] : 0);
        const startNodeLen = startNode.textContent?.length ?? 0;
        if (startOffset < 0 || startOffset > startNodeLen) return null;

        let endNodeIdx = startNodeIdx;
        while (endNodeIdx < allTextNodes.length - 1 && incrLens[endNodeIdx] < span.end) {
            endNodeIdx++;
        }
        const endNode = allTextNodes[endNodeIdx];
        const endOffset = span.end - (endNodeIdx > 0 ? incrLens[endNodeIdx - 1] : 0);
        const endNodeLen = endNode.textContent?.length ?? 0;
        if (endOffset < 0 || endOffset > endNodeLen) return null;

        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);

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
    caseMode: CaseSensitiveMode = getCaseMode(),
): DomHit[] {
    const needle = normalizeSearchValue(value);
    if (!needle) return [];

    const docRoot = getDocRoot(protyleEl);
    if (!docRoot) return [];

    const caseSensitive = resolveCaseSensitive(caseMode);
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

        const { nodes, incrLens, text } = collectOwnTextNodes(blockEl);
        if (!text) continue;

        const spans = findMatchSpans(text, needle, caseSensitive);
        spans.forEach((span, occ) => {
            const range = createRangeForSpan(span, nodes, incrLens);
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
    caseMode?: CaseSensitiveMode,
): DomHit[] {
    if (!normalizeSearchValue(value)) {
        clearHighlight(source);
        return [];
    }
    const hits = calculateDomHits(protyleEl, value, caseMode ?? getCaseMode());
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
 * 在当前 DOM 命中中查找与 FindMatch 对齐的项；
 * occ 对不齐时回退到同块第一个 / 最接近的 occ。
 */
export function resolveDomHit(source: object, match: FindMatch): DomHit | undefined {
    const hits = getDomHits(source);
    const sameBlock = hits.filter((h) => h.blockId === match.blockId);
    if (sameBlock.length === 0) return undefined;
    return (
        sameBlock.find((h) => h.occ === match.occ) ??
        sameBlock.reduce((best, h) =>
            Math.abs(h.occ - match.occ) < Math.abs(best.occ - match.occ) ? h : best,
        )
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
    if (!hit) return false;
    scrollToRange(source, protyleEl, hit.range, scroll);
    return true;
}

export { normalizeSearchValue } from "./match-text";
