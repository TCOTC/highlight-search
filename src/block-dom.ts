/** 文档正文根（与 DOM 高亮扫描范围一致：wysiwyg / 预览） */
export function getDocRoot(protyleEl: Element): HTMLElement | null {
    return protyleEl.querySelector(
        ":is(.protyle-content:not(.fn__none) .protyle-wysiwyg, .protyle-preview:not(.fn__none) .b3-typography)",
    );
}

/**
 * 在当前 protyle 内查找非 embed 的块元素。
 * 优先在正文根内查找，并优先返回带 SVG / data-content 的实例（避免命中重复 id 的空壳节点）。
 */
export function findBlockElement(protyleEl: Element, blockId: string): HTMLElement | null {
    const docRoot = getDocRoot(protyleEl);
    const scopes: Element[] = docRoot ? [docRoot, protyleEl] : [protyleEl];
    const seen = new Set<Element>();

    for (const scope of scopes) {
        const candidates = scope.querySelectorAll(`[data-node-id="${blockId}"]`);
        let fallback: HTMLElement | null = null;
        for (const node of candidates) {
            const el = node as HTMLElement;
            if (seen.has(el)) continue;
            seen.add(el);
            if (el.closest?.('[data-type="NodeBlockQueryEmbed"]')) {
                continue;
            }
            // 图表渲染后正文在 SVG；空壳节点可能同 id 先出现
            if (el.querySelector("svg") || el.hasAttribute("data-content")) {
                return el;
            }
            if (!fallback) fallback = el;
        }
        if (fallback) return fallback;
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
 * 块是否已在编辑器里且可被滚动看见（无需思源 getDoc / 离屏 DOM）。
 */
export function isBlockVisuallyInDom(el: HTMLElement | null): el is HTMLElement {
    return !!el && el.clientHeight > 0 && !isHiddenByFold(el);
}
