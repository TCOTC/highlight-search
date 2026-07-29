import { normalizeSearchValue } from "../match-text";
import { calculateDomHits, type DomHit } from "./dom-hits";

export type { DomHit };

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

export function getDomHits(source: object): DomHit[] {
    return domHitsBySource.get(source) ?? [];
}
