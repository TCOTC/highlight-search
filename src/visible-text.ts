type ProtyleRenderer = {
    mathRender?: (el: Element) => void;
    highlightRender?: (el: Element) => void;
    mermaidRender?: (el: Element) => void;
    flowchartRender?: (el: Element) => void;
    chartRender?: (el: Element) => void;
    graphvizRender?: (el: Element) => void;
    abcRender?: (el: Element) => void;
    mindmapRender?: (el: Element) => void;
    plantumlRender?: (el: Element) => void;
    htmlRender?: (el: Element) => void;
};

const RENDER_METHODS = [
    "mathRender",
    "highlightRender",
    "mermaidRender",
    "flowchartRender",
    "chartRender",
    "graphvizRender",
    "abcRender",
    "mindmapRender",
    "plantumlRender",
    "htmlRender",
] as const;

const SKIP_PARENT_SELECTOR =
    'style, script, .protyle-attr, .katex-mathml, [data-subtype="math"]:not([data-render="true"])';

function getProtyleRenderer(): ProtyleRenderer | null {
    const win = window as Window & { Protyle?: ProtyleRenderer };
    return win.Protyle ?? null;
}

function createOffscreenHost(): HTMLElement {
    const host = document.createElement("div");
    host.className = "protyle-wysiwyg";
    host.style.cssText =
        "position:fixed;left:-10000px;top:0;width:800px;pointer-events:none;opacity:0";
    document.body.appendChild(host);
    return host;
}

function callRenders(host: Element): void {
    const renderer = getProtyleRenderer();
    if (!renderer) return;
    for (const method of RENDER_METHODS) {
        const fn = renderer[method];
        if (typeof fn !== "function") continue;
        try {
            fn(host);
        } catch {
            // 渲染失败时继续提取其余可见文本
        }
    }
}

async function waitForMath(root: Element, timeoutMs = 4000): Promise<void> {
    const start = Date.now();
    while (root.querySelector('[data-subtype="math"]:not([data-render="true"])')) {
        if (Date.now() - start > timeoutMs) break;
        await new Promise((resolve) => setTimeout(resolve, 40));
    }
}

/** 无 Protyle 时剔除未渲染公式，避免 LaTeX 源进入匹配 */
function removeUnrenderedMath(host: Element): void {
    host.querySelectorAll('[data-subtype="math"]:not([data-render="true"])').forEach((el) => {
        el.remove();
    });
}

function isLayoutHidden(parent: Element): boolean {
    const el = parent as HTMLElement;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
        return true;
    }
    if (!el.isConnected || typeof el.getClientRects !== "function") {
        return false;
    }
    const hostRects = el.ownerDocument.body?.getClientRects();
    if (!hostRects || hostRects.length === 0) {
        return false;
    }
    return el.getClientRects().length === 0;
}

function stripZeroWidthNoise(text: string): string {
    return text.replace(/^[\u200b\ufeff]+/, "").replace(/[\u200b\ufeff]+$/, "");
}

/**
 * 从已挂载并渲染过的块 DOM 根节点提取用户可见文本。
 * 只认「本块自身」文本：嵌套 [data-node-id] 子块跳过，避免列表项等容器与子段落重复计数。
 * data-href 等属性不会进入 textContent。
 */
function extractVisibleText(root: Element): string {
    const blockRoot =
        root.querySelector(":scope > [data-node-id]") ??
        (root.hasAttribute("data-node-id") ? root : null) ??
        root;

    blockRoot.querySelectorAll(".protyle-attr, style, script, [hidden]").forEach((el) => {
        el.remove();
    });

    const parts: string[] = [];
    const walker = document.createTreeWalker(blockRoot, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const textNode = node as Text;
            const parent = textNode.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;

            const content = textNode.textContent ?? "";
            if (!content || /^[\u200b\ufeff]+$/.test(content)) {
                return NodeFilter.FILTER_REJECT;
            }
            if (parent.closest(SKIP_PARENT_SELECTOR)) {
                return NodeFilter.FILTER_REJECT;
            }
            if (parent.closest('[aria-hidden="true"]')) {
                return NodeFilter.FILTER_REJECT;
            }
            // 文本落在嵌套块内则跳过（与 search.ts collectOwnTextNodes 一致）
            const nestedBlock = parent.closest("[data-node-id]");
            if (nestedBlock && nestedBlock !== blockRoot) {
                return NodeFilter.FILTER_REJECT;
            }
            if (isLayoutHidden(parent)) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        },
    });

    let current = walker.nextNode();
    while (current) {
        parts.push((current as Text).textContent ?? "");
        current = walker.nextNode();
    }
    return stripZeroWidthNoise(parts.join(""));
}

/**
 * 从块 DOM HTML 提取「能直接看到的」文本。
 * 先离屏挂载并调用思源 Protyle 渲染 API，再按 TreeWalker 收集可见文本。
 */
export async function visibleTextFromBlockDom(domHtml: string): Promise<string> {
    if (!domHtml) return "";

    const host = createOffscreenHost();
    try {
        host.innerHTML = domHtml;
        if (getProtyleRenderer()) {
            callRenders(host);
            await waitForMath(host);
        } else {
            removeUnrenderedMath(host);
        }
        return extractVisibleText(host);
    } finally {
        host.remove();
    }
}
