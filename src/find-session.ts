import type { App } from "siyuan";
import { buildMatchList, type FindMatch } from "./block-search";
import { findBlockElement } from "./block-dom";
import { isDebugEnabled } from "./case-settings";
import { locateMatch } from "./locate";
import { normalizeSearchValue } from "./match-text";
import {
    clearHighlight,
    flashBlockFocus,
    focusFindMatch,
    highlightDomHits,
} from "./search";
import {
    isDiagramContentBlock,
    waitForBlockDiagramReady,
} from "./visible-text";

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
    /** 取消过期的「等 mermaid 再高亮」 */
    private diagramFocusToken = 0;

    get count(): number {
        return this.matches.length;
    }

    clear(source: object) {
        this.buildToken++;
        this.diagramFocusToken++;
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
        if (change) {
            this.index = matches.length > 0 ? 1 : 0;
        } else if (this.index > matches.length) {
            this.index = matches.length > 0 ? matches.length : 0;
        }

        highlightDomHits(ctx.source, ctx.protyleEl, needle, ctx.caseSensitive, ctx.wholeWord);
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

    /**
     * 图表异步渲染完成后重扫高亮并聚焦；token 用于取消过期请求。
     */
    private async focusAfterDiagramReady(
        ctx: FindSessionContext,
        match: FindMatch,
        blockEl: HTMLElement,
        scroll: boolean,
    ): Promise<void> {
        const token = ++this.diagramFocusToken;
        await waitForBlockDiagramReady(blockEl);
        if (token !== this.diagramFocusToken) return;
        const current = this.currentMatch();
        if (
            !current ||
            current.blockId !== match.blockId ||
            current.occ !== match.occ
        ) {
            return;
        }
        this.refreshDomHighlights(ctx);
        if (focusFindMatch(ctx.source, ctx.protyleEl, match, scroll)) {
            this.pending = null;
        }
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
            const ok = focusFindMatch(ctx.source, ctx.protyleEl, match, scroll);
            if (!ok) {
                // DOM 有块但词级未对齐：按需滚到块；图表可能尚未画出 SVG
                if (isDebugEnabled()) {
                    console.log("[jchs focus] 词级未对齐，滚到块元素", {
                        matchBlockId: match.blockId,
                        matchOcc: match.occ,
                        element: result.element,
                    });
                }
                if (scroll) {
                    result.element.scrollIntoView({ block: "center", inline: "nearest" });
                }
                flashBlockFocus(result.element);
                if (isDiagramContentBlock(result.element)) {
                    void this.focusAfterDiagramReady(ctx, match, result.element, scroll);
                }
            }
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
        if (focusFindMatch(ctx.source, ctx.protyleEl, match, scroll)) {
            this.pending = null;
            return;
        }
        const el = findBlockElement(ctx.protyleEl, match.blockId);
        if (el && isDiagramContentBlock(el)) {
            if (scroll) {
                el.scrollIntoView({ block: "center", inline: "nearest" });
            }
            flashBlockFocus(el);
            void this.focusAfterDiagramReady(ctx, match, el, scroll);
        }
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
}
