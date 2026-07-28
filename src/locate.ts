import { openMobileFileById, openTab } from "siyuan";
import type { App } from "siyuan";
import type { FindMatch } from "./block-search";
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
 * 跳转到未加载块：仅 cb-get-context，不做官方块闪烁。
 * 文档已打开时会走 switchEditor → getDoc(mode=3) 装入 DOM。
 */
export function openBlockInEditor(app: App, blockId: string, afterOpen?: () => void): void {
    if (isMobile()) {
        openMobileFileById(app, blockId, ["cb-get-context"]);
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
            action: ["cb-get-context"],
        },
        removeCurrentTab: false,
        afterOpen,
    });
}

export type LocateResult =
    | { status: "in-dom"; element: HTMLElement }
    | { status: "loading" }
    | { status: "empty" };

/**
 * 定位匹配：块已在 DOM 则返回元素；否则触发装载并返回 loading。
 */
export function locateMatch(
    app: App,
    protyleEl: Element,
    match: FindMatch | undefined,
    onLoaded?: () => void,
): LocateResult {
    if (!match) return { status: "empty" };
    const el = findBlockElement(protyleEl, match.blockId);
    if (el && el.clientHeight > 0) {
        return { status: "in-dom", element: el };
    }
    openBlockInEditor(app, match.blockId, onLoaded);
    return { status: "loading" };
}
