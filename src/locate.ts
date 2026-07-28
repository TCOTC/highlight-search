import { fetchPost, openMobileFileById, openTab } from "siyuan";
import type { App } from "siyuan";
import type { FindMatch } from "./block-search";
import { isDebugEnabled } from "./case-settings";
import { isMobile } from "./utils";

/** 在当前 protyle 内查找非 embed 的块元素 */
export function findBlockElement(protyleEl: Element, blockId: string): HTMLElement | null {
    const candidates = protyleEl.querySelectorAll(`[data-node-id="${blockId}"]`);
    for (const el of candidates) {
        if ((el as HTMLElement).closest?.("[data-type=\"NodeBlockQueryEmbed\"]")) {
            continue;
        }
        return el as HTMLElement;
    }
    return null;
}

/**
 * 是否被祖先折叠隐藏（列表 fold / 标题 fold 等）。
 * 块自身 fold="1" 仍可见，只有落在折叠祖先下才算看不见。
 */
export function isHiddenByFold(el: HTMLElement): boolean {
    let parent: HTMLElement | null = el.parentElement;
    while (parent) {
        if (parent.getAttribute("fold") === "1") return true;
        parent = parent.parentElement;
    }
    return false;
}

/**
 * 块是否已在编辑器里且可被滚动看见（无需思源 getDoc）。
 */
export function isBlockVisuallyInDom(el: HTMLElement | null): el is HTMLElement {
    return !!el && el.clientHeight > 0 && !isHiddenByFold(el);
}

/**
 * 对齐思源 checkFold：折叠内用 focus+all+zoomIn，否则 focus+context。
 * 不做 cb-get-hl（官方闪烁）；聚焦由 cb-get-focus 完成。
 */
export function openBlockInEditor(app: App, blockId: string, afterOpen?: () => void): void {
    fetchPost("/api/block/checkBlockFold", { id: blockId }, (foldResponse) => {
        const isFolded = !!foldResponse?.data?.isFolded;
        // 与 app/src/util/noRelyPCFunction.ts checkFold 一致
        const action = isFolded
            ? ["cb-get-focus", "cb-get-all"]
            : ["cb-get-focus", "cb-get-context", "cb-get-rootscroll"];
        if (isDebugEnabled()) {
            console.log("[jchs locate] 思源 openTab", { blockId, isFolded, action, zoomIn: isFolded });
        }

        if (isMobile()) {
            openMobileFileById(app, blockId, action);
            // 移动端无 afterOpen；依赖 loaded-protyle-* 完成后续高亮
            if (afterOpen) {
                window.setTimeout(afterOpen, 300);
            }
            return;
        }
        void openTab({
            app,
            doc: {
                id: blockId,
                action,
                zoomIn: isFolded,
            },
            removeCurrentTab: false,
            afterOpen,
        });
    });
}

export type LocateResult =
    | { status: "in-dom"; element: HTMLElement }
    | { status: "loading" }
    | { status: "empty" };

/**
 * 定位匹配：真正可见则直接用 DOM；否则交给思源 openTab / getDoc。
 */
export function locateMatch(
    app: App,
    protyleEl: Element,
    match: FindMatch | undefined,
    onLoaded?: () => void,
): LocateResult {
    if (!match) return { status: "empty" };
    const el = findBlockElement(protyleEl, match.blockId);
    if (isBlockVisuallyInDom(el)) {
        if (isDebugEnabled()) {
            console.log("[jchs locate] 插件滚动", {
                blockId: match.blockId,
                occ: match.occ,
                clientHeight: el.clientHeight,
                hiddenByFold: false,
            });
        }
        return { status: "in-dom", element: el };
    }
    if (isDebugEnabled()) {
        // 类型守卫失败后 el 被收窄为 null，运行时仍可能是不可见块
        const blockEl = el as HTMLElement | null;
        console.log("[jchs locate] 需思源跳转", {
            blockId: match.blockId,
            occ: match.occ,
            inDom: !!blockEl,
            clientHeight: blockEl?.clientHeight ?? -1,
            hiddenByFold: blockEl ? isHiddenByFold(blockEl) : false,
        });
    }
    openBlockInEditor(app, match.blockId, onLoaded);
    return { status: "loading" };
}
