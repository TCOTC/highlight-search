import { collectOwnTextNodes } from "./collect";
import {
    dataContentTextFromBlock,
    ensureDiagramBlocksHaveWidth,
    waitForDiagramOutputs,
} from "./diagram";
import { removeUnrenderedMath, waitForMath } from "./math";
import { callRenders, createOffscreenHost, getProtyleRenderer } from "./offscreen";

/**
 * 从已挂载的块元素提取可见文本（不改 DOM）。
 * 优先元素内实际文本（与高亮一致）；几乎无正文时回退 data-content（未画出 SVG / 抽空）。
 */
export type VisibleTextInfo = {
    text: string;
    /** 正文来自 data-content 回退（无法在 DOM 上词级定位） */
    fromDataContent: boolean;
};

function meaningfulTextLength(text: string): number {
    return text.replace(/[\u200b\ufeff\s]/g, "").length;
}

export function inspectVisibleTextFromBlockElement(blockEl: Element): VisibleTextInfo {
    const walked = collectOwnTextNodes(blockEl).text;
    if (meaningfulTextLength(walked) > 0) {
        return { text: walked, fromDataContent: false };
    }
    const fromContent = dataContentTextFromBlock(blockEl);
    if (meaningfulTextLength(fromContent) > 0) {
        return { text: fromContent, fromDataContent: true };
    }
    return { text: walked, fromDataContent: false };
}

export function visibleTextFromBlockElement(blockEl: Element): string {
    return inspectVisibleTextFromBlockElement(blockEl).text;
}

/**
 * 从已挂载并渲染过的块 DOM 根节点提取用户可见文本。
 * 离屏路径可先剔除 attr / style；图表仅在抽不到正文时回退 data-content。
 */
function extractVisibleText(root: Element): VisibleTextInfo {
    const blockRoot =
        root.querySelector(":scope > [data-node-id]") ??
        (root.hasAttribute("data-node-id") ? root : null) ??
        root;

    blockRoot.querySelectorAll(".protyle-attr, style, script, [hidden]").forEach((el) => {
        el.remove();
    });

    // 离屏勿 rejectLayoutHidden：宿主在屏外时 getClientRects 易为空，会误删 SVG 正文
    const walked = collectOwnTextNodes(blockRoot, { rejectLayoutHidden: false }).text;
    if (meaningfulTextLength(walked) > 0) {
        return { text: walked, fromDataContent: false };
    }

    const fromContent = dataContentTextFromBlock(blockRoot);
    if (meaningfulTextLength(fromContent) > 0) {
        return { text: fromContent, fromDataContent: true };
    }
    return { text: walked, fromDataContent: false };
}

/**
 * 从块 DOM HTML 提取「能直接看到的」文本。
 * 先离屏挂载并调用思源 Protyle 渲染 API；图表在渲染失败时回退 data-content。
 */
export async function inspectVisibleTextFromBlockDom(
    domHtml: string,
): Promise<VisibleTextInfo> {
    if (!domHtml) return { text: "", fromDataContent: false };

    const host = createOffscreenHost();
    try {
        host.innerHTML = domHtml;
        if (getProtyleRenderer()) {
            ensureDiagramBlocksHaveWidth(host);
            callRenders(host);
            await Promise.all([waitForMath(host), waitForDiagramOutputs(host)]);
        } else {
            removeUnrenderedMath(host);
        }
        return extractVisibleText(host);
    } finally {
        host.remove();
    }
}

export async function visibleTextFromBlockDom(domHtml: string): Promise<string> {
    return (await inspectVisibleTextFromBlockDom(domHtml)).text;
}
