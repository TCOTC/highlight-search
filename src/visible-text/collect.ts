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
