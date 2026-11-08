/**
 * 这些容器块自身 DOM 只有思源生成的导航 / 预览控件，不按正文计文本。
 * Callout 标题等属于用户正文的容器内容仍需扫描，因此不在列表内。
 */
const GENERATED_UI_CONTAINER_BLOCK_TYPES = new Set([
    "NodeDocument",
    "NodeList",
    "NodeListItem",
    "NodeBlockquote",
    "NodeSuperBlock",
    "NodeTabs",
    "NodeTabItem",
    "NodeMindmap",
    "NodeMindmapItem",
]);

/**
 * 元素是否属于传入的 protyle，而不是其内部嵌套的片段编辑器。
 * 文档名富文本、表格单元格富文本等会挂载独立 Protyle，不能混入正文。
 */
export function isOwnProtyleElement(el: Element, protyleEl: Element): boolean {
    const owner = el.closest(".protyle");
    return !owner || owner === protyleEl;
}

/** 文档正文根（与 DOM 高亮扫描范围一致：wysiwyg / 预览） */
export function getDocRoot(protyleEl: Element): HTMLElement | null {
    const roots = protyleEl.querySelectorAll<HTMLElement>(
        ":is(.protyle-content:not(.fn__none) .protyle-wysiwyg, .protyle-preview:not(.fn__none) .b3-typography)",
    );
    for (const root of roots) {
        if (isOwnProtyleElement(root, protyleEl)) {
            return root;
        }
    }
    return null;
}

/** 当前 Protyle 自己的可滚动内容区（编辑 / 预览），不取嵌套片段编辑器的内容区 */
export function getDocContentElement(protyleEl: Element): HTMLElement | null {
    const elements = protyleEl.querySelectorAll<HTMLElement>(
        ":is(.protyle-content:not(.fn__none), .protyle-preview:not(.fn__none))",
    );
    for (const element of elements) {
        if (isOwnProtyleElement(element, protyleEl)) {
            return element;
        }
    }
    return null;
}

/**
 * 块元素是否属于当前文档正文：排除容器块与嵌套 Protyle 内的临时块。
 */
export function isContentBlockElement(el: Element, protyleEl: Element): boolean {
    if (!isOwnProtyleElement(el, protyleEl)) return false;
    return !GENERATED_UI_CONTAINER_BLOCK_TYPES.has(el.getAttribute("data-type") || "");
}

/**
 * 是否为中心页签的主编辑器：Protyle 本身就是页签面板（`.layout-tab-container` 的直接子节点）。
 * 文档名富文本、表格单元格、反链浮窗与全局搜索预览的 Protyle 都挂在别的容器里，不能当作当前文档。
 */
export function isDocumentTabProtyle(element: Element): boolean {
    return element.parentElement?.classList.contains("layout-tab-container") === true &&
        !!element.closest(".layout__center");
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
            if (!isOwnProtyleElement(el, protyleEl)) {
                continue;
            }
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
 * 当前页签项是否未显示。
 * 属性缺失时按 tabs-active-id 或首个页签判断，避免依赖渲染时机。
 */
function isTabItemHidden(item: HTMLElement): boolean {
    const hidden = item.getAttribute("data-tabs-hidden");
    if (hidden === "true") return true;
    if (hidden === "false") return false;
    const tabs = item.parentElement;
    if (!tabs?.classList.contains("tabs")) return false;
    const items = Array.from(tabs.children).filter(
        (child) => child.classList.contains("tab-item"),
    ) as HTMLElement[];
    const activeID = tabs.getAttribute("tabs-active-id");
    const active =
        items.find((child) => child.getAttribute("data-node-id") === activeID) || items[0];
    return active !== item;
}

/**
 * 是否落在未激活的原生标签页内（含嵌套标签页）。
 */
export function isHiddenByTabs(el: HTMLElement): boolean {
    for (let item = el.closest<HTMLElement>(".tab-item"); item;) {
        if (isTabItemHidden(item)) return true;
        item = item.parentElement?.closest<HTMLElement>(".tab-item") ?? null;
    }
    return false;
}

/**
 * 激活目标块所在的隐藏标签页。思源点击页签会同步更新 data-tabs-hidden。
 * @returns 是否点击了页签；无法定位页签按钮时返回 false
 */
export function revealHiddenTabAncestors(el: HTMLElement): boolean {
    const items: HTMLElement[] = [];
    for (let item = el.closest<HTMLElement>(".tab-item"); item;
        item = item.parentElement?.closest<HTMLElement>(".tab-item") ?? null) {
        items.unshift(item);
    }

    let revealed = false;
    for (const item of items) {
        if (!isTabItemHidden(item)) continue;
        const tabs = item.parentElement;
        if (!tabs?.classList.contains("tabs")) continue;
        const id = item.getAttribute("data-node-id");
        if (!id) continue;
        const button = Array.from(
            tabs.querySelectorAll<HTMLElement>(":scope > .tabs-header .tabs-list > .tabs-tab"),
        ).find((tab) => tab.dataset.tabId === id);
        if (!button) continue;
        button.click();
        revealed = true;
    }
    return revealed;
}

/**
 * 块是否已在编辑器里且可被滚动看见（无需思源 getDoc / 离屏 DOM）。
 */
export function isBlockVisuallyInDom(el: HTMLElement | null): el is HTMLElement {
    return !!el && el.clientHeight > 0 && !isHiddenByFold(el) && !isHiddenByTabs(el);
}
