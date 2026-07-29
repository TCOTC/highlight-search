import { isDebugEnabled } from "../case-settings";
import type { FindMatch } from "../find-match";
import {
    collectOwnTextNodes,
    dataContentTextFromBlock,
    isDiagramContentBlock,
    waitForBlockDiagramReady,
} from "../visible-text";
import { flashBlockFocus, getDomHits } from "./css-highlight";
import { resolveDomHit } from "./resolve";
import { scrollToRange } from "./scroll";

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

export type FocusFindMatchHooks = {
    refreshDomHighlights: () => void;
    /** 异步重试前确认仍是当前匹配 */
    isStillCurrent: (match: FindMatch) => boolean;
    /** 词级成功后清除 pending 等 */
    onFocused?: () => void;
};

/**
 * 词级聚焦；失败则滚到块 + flash。
 * 图表块会异步等 SVG 后重扫高亮并再聚焦（token 可取消过期请求）。
 */
export class DiagramAwareFocuser {
    private token = 0;

    cancel() {
        this.token++;
    }

    /**
     * @returns focused 词级成功；fallback 已滚块（可能正在等图表）
     */
    focusOrWaitDiagram(
        source: object,
        protyleEl: Element,
        match: FindMatch,
        blockEl: HTMLElement,
        scroll: boolean,
        hooks: FocusFindMatchHooks,
    ): "focused" | "fallback" {
        if (focusFindMatch(source, protyleEl, match, scroll)) {
            hooks.onFocused?.();
            return "focused";
        }

        if (isDebugEnabled()) {
            console.log("[jchs focus] 词级未对齐，滚到块元素", {
                matchBlockId: match.blockId,
                matchOcc: match.occ,
                element: blockEl,
            });
        }
        if (scroll) {
            blockEl.scrollIntoView({ block: "center", inline: "nearest" });
        }
        flashBlockFocus(blockEl);

        if (isDiagramContentBlock(blockEl)) {
            void this.focusAfterDiagramReady(
                source,
                protyleEl,
                match,
                blockEl,
                scroll,
                hooks,
            );
        }
        return "fallback";
    }

    private async focusAfterDiagramReady(
        source: object,
        protyleEl: Element,
        match: FindMatch,
        blockEl: HTMLElement,
        scroll: boolean,
        hooks: FocusFindMatchHooks,
    ): Promise<void> {
        const token = ++this.token;
        await waitForBlockDiagramReady(blockEl);
        if (token !== this.token) return;
        if (!hooks.isStillCurrent(match)) return;
        hooks.refreshDomHighlights();
        if (focusFindMatch(source, protyleEl, match, scroll)) {
            hooks.onFocused?.();
        }
    }
}
