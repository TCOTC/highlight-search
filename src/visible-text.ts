/** 块内文本节点父级跳过选择器（Match 列表与 DOM 高亮共用） */
export const SKIP_OWN_TEXT_PARENT_SELECTOR =
    'style, script, .protyle-attr, .katex-mathml, [data-subtype="math"]:not([data-render="true"])';

export interface CollectOwnTextOptions {
    /**
     * 跳过 CSS layout 隐藏节点。
     * 离屏抽文本可开；活 DOM 高亮勿开（由建 Range 时的可见性判断负责）。
     */
    rejectLayoutHidden?: boolean;
}

export interface OwnTextNodes {
    nodes: Text[];
    /** 节点 i 的文本在 text 中的起始下标 */
    nodeStarts: number[];
    /** 节点 i 的文本在 text 中的结束下标 */
    incrLens: number[];
    text: string;
}

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

/**
 * 思源 mermaid / flowchart 在脚本加载后用 firstElementChild.clientWidth === 0
 * 判断「折叠隐藏」；宽为 0 时只挂 MutationObserver，离屏宿主会永远不 init。
 * @see siyuan app/src/protyle/render/mermaidRender.ts
 */
const DIAGRAM_SUBTYPE_SELECTOR =
    '[data-subtype="mermaid"], [data-subtype="flowchart"]';

/** 图表类 subtype：含 data-content 的渲染代码块 */
const DIAGRAM_CONTENT_SUBTYPES = new Set([
    "mermaid",
    "flowchart",
    "plantuml",
    "mindmap",
    "echarts",
    "graphviz",
    "abc",
]);

const OFFSCREEN_LAYOUT_WIDTH_PX = 800;

function getProtyleRenderer(): ProtyleRenderer | null {
    const win = window as Window & { Protyle?: ProtyleRenderer };
    return win.Protyle ?? null;
}

function createOffscreenHost(): HTMLElement {
    const host = document.createElement("div");
    host.className = "protyle-wysiwyg";
    // 需非 0 布局宽供官方 clientWidth 检查；勿 max-height/overflow 裁切，否则抽文本会被当成 layout 隐藏
    host.style.cssText =
        `position:fixed;left:-${OFFSCREEN_LAYOUT_WIDTH_PX * 2}px;top:0;` +
        `width:${OFFSCREEN_LAYOUT_WIDTH_PX}px;pointer-events:none;opacity:0;z-index:-1`;
    document.body.appendChild(host);
    return host;
}

/**
 * 满足官方 mermaidRender / flowchartRender 的「可见」宽度检查，避免进 hideElements 死等。
 */
function ensureDiagramBlocksHaveWidth(host: HTMLElement): void {
    host.querySelectorAll(`${DIAGRAM_SUBTYPE_SELECTOR}, .render-node[data-content]`).forEach((el) => {
        const block = el as HTMLElement;
        block.style.minWidth = `${OFFSCREEN_LAYOUT_WIDTH_PX}px`;
        block.style.width = `${OFFSCREEN_LAYOUT_WIDTH_PX}px`;
        let first = block.firstElementChild as HTMLElement | null;
        if (!first) {
            first = document.createElement("div");
            block.insertBefore(first, block.firstChild);
        }
        first.style.minWidth = `${OFFSCREEN_LAYOUT_WIDTH_PX}px`;
        first.style.width = `${OFFSCREEN_LAYOUT_WIDTH_PX}px`;
        first.style.minHeight = "1px";
    });
    void host.offsetWidth;
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

/**
 * mermaid / flowchart 在 init 里先打 data-render 再 await 画图，故以 svg / 错误节点为准。
 */
async function waitForDiagramOutputs(root: Element, timeoutMs = 6000): Promise<void> {
    if (!root.querySelector(DIAGRAM_SUBTYPE_SELECTOR)) return;

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const nodes = root.querySelectorAll(DIAGRAM_SUBTYPE_SELECTOR);
        let pending = false;
        for (const node of nodes) {
            if (!node.querySelector("svg, .ft__error")) {
                pending = true;
                break;
            }
        }
        if (!pending) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
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

/** 是否为带 data-content 的图表 / 渲染代码块（离屏渲染不可靠） */
export function isDiagramContentBlock(el: Element): boolean {
    const subtype = el.getAttribute("data-subtype") || "";
    if (DIAGRAM_CONTENT_SUBTYPES.has(subtype)) return true;
    return (
        el.classList.contains("render-node") &&
        el.getAttribute("data-type") === "NodeCodeBlock" &&
        el.hasAttribute("data-content")
    );
}

/** 反转义 data-content（对齐思源 Lute.UnEscapeHTMLStr） */
export function unescapeDataContent(raw: string): string {
    if (!raw) return "";
    const lute = (window as Window & { Lute?: { UnEscapeHTMLStr?: (s: string) => string } }).Lute;
    if (typeof lute?.UnEscapeHTMLStr === "function") {
        return lute.UnEscapeHTMLStr(raw);
    }
    const textarea = document.createElement("textarea");
    textarea.innerHTML = raw;
    return textarea.value;
}

/** 从块根读取图表源码文本 */
export function dataContentTextFromBlock(blockEl: Element): string {
    const raw = blockEl.getAttribute("data-content");
    if (raw == null || raw === "") return "";
    return unescapeDataContent(raw);
}

/**
 * 等待图表块出现 svg / 错误节点（官方异步 mermaidRender 完成后）。
 * 非图表块立即返回 true。
 */
export async function waitForBlockDiagramReady(
    blockEl: Element,
    timeoutMs = 6000,
): Promise<boolean> {
    if (!isDiagramContentBlock(blockEl)) return true;
    if (blockEl.querySelector("svg, .ft__error")) return true;

    const start = Date.now();
    return await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            observer.disconnect();
            window.clearInterval(poll);
            resolve(ok);
        };
        const observer = new MutationObserver(() => {
            if (blockEl.querySelector("svg, .ft__error")) finish(true);
        });
        observer.observe(blockEl, { childList: true, subtree: true, attributes: true });
        const poll = window.setInterval(() => {
            if (blockEl.querySelector("svg, .ft__error")) {
                finish(true);
                return;
            }
            if (Date.now() - start >= timeoutMs) finish(false);
        }, 50);
    });
}

/**
 * TreeWalker 是否接受该文本节点（本块自身正文，不含嵌套子块）。
 */
export function acceptOwnTextNode(
    node: Node,
    blockRoot: Element,
    opts: CollectOwnTextOptions = {},
): number {
    const textNode = node as Text;
    const parent = textNode.parentElement;
    if (!parent) return NodeFilter.FILTER_REJECT;

    const content = textNode.textContent ?? "";
    if (!content || /^[\u200b\ufeff]+$/.test(content)) {
        return NodeFilter.FILTER_REJECT;
    }
    if (parent.closest(SKIP_OWN_TEXT_PARENT_SELECTOR)) {
        return NodeFilter.FILTER_REJECT;
    }
    // 图表 SVG 常带 aria-hidden，但仍是用户看见的标签正文，搜索需保留
    if (parent.closest('[aria-hidden="true"]') && !parent.closest("svg")) {
        return NodeFilter.FILTER_REJECT;
    }
    const nestedBlock = parent.closest("[data-node-id]");
    if (nestedBlock && nestedBlock !== blockRoot) {
        return NodeFilter.FILTER_REJECT;
    }
    if (opts.rejectLayoutHidden && isLayoutHidden(parent)) {
        return NodeFilter.FILTER_REJECT;
    }
    return NodeFilter.FILTER_ACCEPT;
}

/**
 * 相邻文本是否应插入分隔空格（避免 SVG 多段 <text> 等粘成一词）。
 * 同一元素内、或内联拆分（strong/em 等）不插，以免拆开单词。
 */
function shouldInsertSpaceBetweenTextNodes(prev: Text, next: Text): boolean {
    const prevText = prev.textContent ?? "";
    const nextText = next.textContent ?? "";
    if (!prevText || !nextText) return false;
    if (/\s$/.test(prevText) || /^\s/.test(nextText)) return false;

    const prevEl = prev.parentElement;
    const nextEl = next.parentElement;
    if (!prevEl || !nextEl || prevEl === nextEl) return false;

    // 同一 SVG <text> 内的 tspan 拆分不插空格
    const prevSvgText = prevEl.closest("text");
    const nextSvgText = nextEl.closest("text");
    if (prevSvgText && prevSvgText === nextSvgText) return false;

    const inlineRe =
        /^(SPAN|STRONG|EM|B|I|A|MARK|CODE|S|U|SUP|SUB|KBD|FONT|LABEL|TSPAN)$/i;
    // 父节点为内联、且同属一个块级父：视为样式拆分
    if (inlineRe.test(prevEl.tagName) || inlineRe.test(nextEl.tagName)) {
        if (prevEl.parentElement && prevEl.parentElement === nextEl.parentElement) {
            return false;
        }
        if (nextEl.parentElement === prevEl || prevEl.parentElement === nextEl) {
            return false;
        }
    }
    return true;
}

/**
 * 收集块元素自身的文本节点（排除嵌套 [data-node-id]，避免父子双重计数）。
 * 不同元素边界在无空白时插入空格，便于列表 snippet 阅读；
 * Match 列表与 DOM 高亮共用，保证 occ 偏移一致。
 */
export function collectOwnTextNodes(
    blockEl: Element,
    opts: CollectOwnTextOptions = {},
): OwnTextNodes {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            return acceptOwnTextNode(node, blockEl, opts);
        },
    });
    let current = walker.nextNode();
    while (current) {
        nodes.push(current as Text);
        current = walker.nextNode();
    }

    let text = "";
    const nodeStarts: number[] = [];
    const incrLens: number[] = [];
    for (let i = 0; i < nodes.length; i++) {
        const piece = nodes[i].textContent ?? "";
        if (i > 0 && shouldInsertSpaceBetweenTextNodes(nodes[i - 1], nodes[i])) {
            text += " ";
        }
        nodeStarts.push(text.length);
        text += piece;
        incrLens.push(text.length);
    }
    return { nodes, nodeStarts, incrLens, text };
}

/**
 * 从已挂载的块元素提取可见文本（不改 DOM）。
 * 优先元素内实际文本（与高亮一致）；几乎无正文时回退 data-content（未画出 SVG / 抽空）。
 */
export type VisibleTextInfo = {
    text: string;
    /** 正文来自 data-content 回退（无法在 DOM 上词级定位） */
    fromDataContent: boolean;
};

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

function meaningfulTextLength(text: string): number {
    return text.replace(/[\u200b\ufeff\s]/g, "").length;
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
