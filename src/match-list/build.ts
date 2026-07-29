import { findBlockElement, isBlockVisuallyInDom } from "../block-dom";
import { isDebugEnabled } from "../case-settings";
import type { FindMatch } from "../find-match";
import {
    findMatchSpans,
    makeSnippetFromSpan,
    makeSnippetFromSpans,
    normalizeSearchValue,
    type TextSpan,
} from "../match-text";
import { fetchDocBlocksOrders, orderIdsByDocOrder } from "./doc-order";
import { resolveVisibleTexts } from "./resolve-texts";
import { fetchCandidateIdsBySql } from "./sql-candidates";

export interface BuildMatchListOptions {
    rootId: string;
    notebookId: string;
    query: string;
    caseSensitive: boolean;
    /** 全字匹配；默认 false */
    wholeWord?: boolean;
    /**
     * 当前编辑器根；已在 DOM 且可见的候选块走活 DOM 抽文本，跳过 getBlockDOMs。
     */
    protyleEl?: Element | null;
}

/**
 * 建全文档 Match 列表（插件 DOM 流水线）。
 */
export async function buildMatchList(opts: BuildMatchListOptions): Promise<FindMatch[]> {
    return buildMatchListViaDom(opts);
}

/**
 * 插件 DOM 流水线：
 * 1. SQL 粗筛候选 ID（content 可能含链接 URL）
 * 2. 已渲染块走活 DOM；其余 getBlockDOMs 离屏（与 getDocBlocksOrders 并行）
 * 3. 按文档阅读序排列命中块
 * 4. 在可见文本上展开 occ
 */
async function buildMatchListViaDom(opts: BuildMatchListOptions): Promise<FindMatch[]> {
    const needle = normalizeSearchValue(opts.query);
    const debug = isDebugEnabled();
    if (!needle || !opts.rootId) {
        if (debug) {
            console.info("[highlight-search] match-list abort", {
                needle,
                rootId: opts.rootId || "(empty)",
            });
        }
        return [];
    }

    const { caseSensitive, wholeWord = false } = opts;

    const candidateIds = await fetchCandidateIdsBySql(opts.rootId, needle, caseSensitive);
    if (debug) {
        console.info("[highlight-search] match-list sql", {
            rootId: opts.rootId,
            needle,
            caseSensitive,
            wholeWord,
            candidateCount: candidateIds.length,
            candidateIds: candidateIds.slice(0, 20),
        });
    }
    if (candidateIds.length === 0) return [];

    // 文档序只依赖 rootId，与可见文本解析并行，隐藏一次 API 往返
    const [visibleById, docOrder] = await Promise.all([
        resolveVisibleTexts(candidateIds, opts.notebookId, opts.protyleEl),
        fetchDocBlocksOrders(opts.rootId),
    ]);

    const spansById = new Map<string, TextSpan[]>();
    const matchedIds: string[] = [];
    for (const id of candidateIds) {
        const info = visibleById.get(id) || { text: "", fromDataContent: false };
        const text = info.text;
        const spans = findMatchSpans(text, needle, caseSensitive, wholeWord);
        if (spans.length > 0) {
            spansById.set(id, spans);
            matchedIds.push(id);
        } else if (debug) {
            const el = opts.protyleEl ? findBlockElement(opts.protyleEl, id) : null;
            const dup = opts.protyleEl
                ? opts.protyleEl.querySelectorAll(`[data-node-id="${id}"]`).length
                : 0;
            console.info("[highlight-search] match-list no-span", {
                id,
                textLen: text.length,
                textPreview: text.slice(0, 160),
                fromDataContent: info.fromDataContent,
                inDom: !!el,
                visuallyInDom: isBlockVisuallyInDom(el),
                clientHeight: el?.clientHeight ?? null,
                subtype: el?.getAttribute("data-subtype"),
                hasDataContent: !!el?.hasAttribute("data-content"),
                dataContentLen: (el?.getAttribute("data-content") || "").length,
                svgCount: el?.querySelectorAll("svg").length ?? 0,
                svgTextCount: el?.querySelectorAll("svg text, svg tspan").length ?? 0,
                duplicateIds: dup,
            });
        }
    }
    if (matchedIds.length === 0) {
        if (debug) {
            console.info("[highlight-search] match-list empty after visible-text");
        }
        return [];
    }

    const orderedIds = orderIdsByDocOrder(matchedIds, docOrder);

    const matches: FindMatch[] = [];
    for (const id of orderedIds) {
        const info = visibleById.get(id) || { text: "", fromDataContent: false };
        const text = info.text;
        const spans = spansById.get(id) || [];
        // data-content 回退：无法词级定位，按块合并为一条，snippet 标出全部命中
        if (info.fromDataContent) {
            const snippet = makeSnippetFromSpans(text, spans);
            matches.push({
                blockId: id,
                occ: 0,
                snippet: snippet.text,
                snippetMatches: snippet.matches,
            });
            continue;
        }
        for (let occ = 0; occ < spans.length; occ++) {
            const snippet = makeSnippetFromSpan(text, spans[occ]);
            matches.push({
                blockId: id,
                occ,
                snippet: snippet.text,
                snippetMatches: [{ start: snippet.matchStart, end: snippet.matchEnd }],
            });
        }
    }
    if (debug) {
        console.info("[highlight-search] match-list done", {
            matchedBlockCount: matchedIds.length,
            matchCount: matches.length,
        });
    }
    return matches;
}
