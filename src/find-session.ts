import type { App } from "siyuan";
import { findBlockElement } from "./block-dom";
import type { FindMatch } from "./find-match";
import {
    clearHighlight,
    DiagramAwareFocuser,
    focusFindMatch,
    highlightDomHits,
    type DomHit,
} from "./highlight";
import { locateMatch } from "./locate";
import { buildMatchList } from "./match-list";
import { normalizeSearchValue } from "./match-text";
import { applyOccReplace } from "./replace/apply-occ";

export type { FindMatch } from "./find-match";

export interface FindSessionContext {
    app: App;
    protyleEl: Element;
    rootId: string;
    notebookId: string;
    /** 本搜索框是否区分大小写（实例独立） */
    caseSensitive: boolean;
    /** 本搜索框是否全字匹配（实例独立；默认 false） */
    wholeWord: boolean;
    /** 高亮 / 滚动的 source（通常为 SearchBox 实例） */
    source: object;
}

/** 编辑器可滚动内容区的视口矩形 */
function getEditorViewportRect(protyleEl: Element): DOMRect | null {
    const content = protyleEl.querySelector(
        ":is(.protyle-content:not(.fn__none), .protyle-preview:not(.fn__none))",
    ) as HTMLElement | null;
    return content?.getBoundingClientRect() ?? null;
}

function rangeIntersectsViewport(rangeRect: DOMRect, viewport: DOMRect): boolean {
    return (
        rangeRect.bottom > viewport.top &&
        rangeRect.top < viewport.bottom &&
        rangeRect.right > viewport.left &&
        rangeRect.left < viewport.right
    );
}

/**
 * 新搜索时的初始 1-based 下标：优先可视区内离视口中心最近的命中，否则第一个。
 * 调用方保证 matches 非空时再使用返回值。
 */
function pickInitialMatchIndex(
    matches: FindMatch[],
    hits: DomHit[],
    protyleEl: Element,
): number {
    if (matches.length === 0) return 0;

    const viewport = getEditorViewportRect(protyleEl);
    if (!viewport || hits.length === 0) return 1;

    const indexByKey = new Map<string, number>();
    for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        indexByKey.set(`${m.blockId}:${m.occ}`, i);
    }

    const centerY = (viewport.top + viewport.bottom) / 2;
    let bestMatchIndex = Infinity;
    let bestDist = Infinity;

    for (const hit of hits) {
        const rect = hit.range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (!rangeIntersectsViewport(rect, viewport)) continue;

        const matchIdx = indexByKey.get(`${hit.blockId}:${hit.occ}`);
        if (matchIdx === undefined) continue;

        const hitCenterY = (rect.top + rect.bottom) / 2;
        const dist = Math.abs(hitCenterY - centerY);
        if (dist < bestDist || (dist === bestDist && matchIdx < bestMatchIndex)) {
            bestDist = dist;
            bestMatchIndex = matchIdx;
        }
    }

    return Number.isFinite(bestMatchIndex) ? bestMatchIndex + 1 : 1;
}

/**
 * 跨卸载仍稳定的搜索会话：Match 列表为真相源，DOM Range 只是当前窗口投影。
 */
export class FindSession {
    query = "";
    matches: FindMatch[] = [];
    /** 1-based 当前项；0 表示无选中 */
    index = 0;
    /** 装载中等待定位的匹配 */
    private pending: FindMatch | null = null;
    private buildToken = 0;
    private readonly diagramFocuser = new DiagramAwareFocuser();

    get count(): number {
        return this.matches.length;
    }

    clear(source: object) {
        this.buildToken++;
        this.diagramFocuser.cancel();
        this.query = "";
        this.matches = [];
        this.index = 0;
        this.pending = null;
        clearHighlight(source);
    }

    /**
     * 重建 Match 列表并刷新当前窗口高亮。
     * @param change 是否视为新搜索（重置 index）
     */
    async rebuild(
        ctx: FindSessionContext,
        query: string,
        change: boolean,
    ): Promise<void> {
        const token = ++this.buildToken;
        const needle = normalizeSearchValue(query);
        this.query = needle;

        if (!needle) {
            this.matches = [];
            this.index = 0;
            this.pending = null;
            clearHighlight(ctx.source);
            return;
        }

        const matches = await buildMatchList({
            rootId: ctx.rootId,
            notebookId: ctx.notebookId,
            query: needle,
            caseSensitive: ctx.caseSensitive,
            wholeWord: ctx.wholeWord,
            protyleEl: ctx.protyleEl,
        });
        if (token !== this.buildToken) return;

        this.matches = matches;
        const hits = highlightDomHits(
            ctx.source,
            ctx.protyleEl,
            needle,
            ctx.caseSensitive,
            ctx.wholeWord,
        );
        if (change) {
            this.index =
                matches.length > 0
                    ? pickInitialMatchIndex(matches, hits, ctx.protyleEl)
                    : 0;
        } else if (this.index > matches.length) {
            this.index = matches.length > 0 ? matches.length : 0;
        }
    }

    /** 仅重扫 DOM 高亮（动态加载后），不改 Match 列表与 index */
    refreshDomHighlights(ctx: FindSessionContext) {
        if (!this.query) {
            clearHighlight(ctx.source);
            return;
        }
        highlightDomHits(ctx.source, ctx.protyleEl, this.query, ctx.caseSensitive, ctx.wholeWord);
    }

    currentMatch(): FindMatch | undefined {
        if (this.index < 1 || this.index > this.matches.length) return undefined;
        return this.matches[this.index - 1];
    }

    private focusHooks(ctx: FindSessionContext) {
        return {
            refreshDomHighlights: () => this.refreshDomHighlights(ctx),
            isStillCurrent: (match: FindMatch) => {
                const current = this.currentMatch();
                return (
                    !!current &&
                    current.blockId === match.blockId &&
                    current.occ === match.occ
                );
            },
            onFocused: () => {
                this.pending = null;
            },
        };
    }

    /**
     * 若当前匹配已在 DOM 命中中，仅更新 focus 高亮。
     * 不滚动、不 openTab；供文档编辑后刷新用。
     */
    syncFocusHighlight(ctx: FindSessionContext) {
        const match = this.currentMatch();
        if (!match) return;
        focusFindMatch(ctx.source, ctx.protyleEl, match, false);
    }

    /**
     * 定位当前 index 对应匹配。
     * 未加载或落在折叠内时交给思源 openTab；完成后由 onAfterLoad / tryResolvePending 继续。
     */
    locateCurrent(
        ctx: FindSessionContext,
        scroll: boolean,
        onAfterLoad?: () => void,
    ): "focused" | "loading" | "empty" {
        const match = this.currentMatch();
        if (!match) {
            this.pending = null;
            return "empty";
        }

        const result = locateMatch(ctx.app, ctx.protyleEl, match, () => {
            this.refreshDomHighlights(ctx);
            this.tryResolvePending(ctx, true);
            onAfterLoad?.();
        });

        if (result.status === "in-dom") {
            this.pending = null;
            // 确保高亮已含该块
            this.refreshDomHighlights(ctx);
            this.diagramFocuser.focusOrWaitDiagram(
                ctx.source,
                ctx.protyleEl,
                match,
                result.element,
                scroll,
                this.focusHooks(ctx),
            );
            return "focused";
        }
        if (result.status === "loading") {
            this.pending = match;
            return "loading";
        }
        return "empty";
    }

    /** 动态加载后尝试完成 pending 定位 */
    tryResolvePending(ctx: FindSessionContext, scroll: boolean) {
        if (!this.pending) return;
        const match = this.pending;
        this.refreshDomHighlights(ctx);
        const el = findBlockElement(ctx.protyleEl, match.blockId);
        if (!el) return;
        this.diagramFocuser.focusOrWaitDiagram(
            ctx.source,
            ctx.protyleEl,
            match,
            el,
            scroll,
            this.focusHooks(ctx),
        );
    }

    goNext(ctx: FindSessionContext): void {
        if (this.count === 0) {
            this.index = 0;
            return;
        }
        this.index = this.index < this.count ? this.index + 1 : 1;
        this.locateCurrent(ctx, true);
    }

    goPrevious(ctx: FindSessionContext): void {
        if (this.count === 0) {
            this.index = 0;
            return;
        }
        this.index = this.index > 1 ? this.index - 1 : this.count;
        this.locateCurrent(ctx, true);
    }

    /** 跳到指定 0-based 列表下标（结果面板点击） */
    goTo(ctx: FindSessionContext, zeroBased: number): void {
        if (zeroBased < 0 || zeroBased >= this.count) return;
        this.index = zeroBased + 1;
        this.locateCurrent(ctx, true);
    }

    /**
     * 替换当前匹配一处；成功后重建列表，尽量停在「下一处」（同下标）。
     */
    async replaceCurrent(
        ctx: FindSessionContext,
        replacement: string,
        preserveCase: boolean,
    ): Promise<"replaced" | "unsupported" | "failed" | "empty"> {
        const match = this.currentMatch();
        if (!match) return "empty";

        const result = await applyOccReplace({
            match,
            protyleEl: ctx.protyleEl,
            source: ctx.source,
            replacement,
            preserveCase,
        });
        if (result.ok === false) {
            const reason = result.reason;
            if (
                reason === "no-match" ||
                reason === "from-data-content" ||
                reason === "block-type" ||
                reason === "code-render-node" ||
                reason === "in-embed" ||
                reason === "in-render-surface" ||
                reason === "inline-denied" ||
                reason === "contenteditable-false"
            ) {
                return "unsupported";
            }
            return "failed";
        }

        const keepIndex = this.index;
        await this.rebuild(ctx, this.query, false);
        if (this.matches.length === 0) {
            this.index = 0;
        } else {
            this.index = Math.min(keepIndex, this.matches.length);
        }
        this.locateCurrent(ctx, true);
        return "replaced";
    }
}
