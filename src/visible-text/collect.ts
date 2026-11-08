/** 块内文本节点父级跳过选择器（Match 列表与 DOM 高亮共用） */
export const SKIP_OWN_TEXT_PARENT_SELECTOR =
    'style, script, .protyle-attr, .katex-mathml, [data-subtype="math"]:not([data-render="true"])';

/** 思源大表格虚拟化把屏外行 / 列源码保存在占位元素属性里 */
const TABLE_VIRTUAL_ROWS_ATTR = "data-sy-table-virtual-rows";
const TABLE_VIRTUAL_COLUMNS_ATTR = "data-sy-table-virtual-columns";
const TABLE_VIRTUAL_ID_ATTR = "data-sy-table-virtual-id";

/**
 * 展开表格虚拟化占位符的副本，让 Match 列表能读到屏外行。
 * 不修改活 DOM；非表格或未虚拟化时直接返回原元素。
 */
export function expandVirtualTableBlock(blockEl: Element): Element {
    if (blockEl.getAttribute("data-type") !== "NodeTable") {
        return blockEl;
    }
    const virtualized = !!blockEl.querySelector(`[${TABLE_VIRTUAL_ROWS_ATTR}], [${TABLE_VIRTUAL_COLUMNS_ATTR}]`);
    // 只有渲染缓存标记时也要走副本，否则写回会把这个属性带进 .sy
    if (!virtualized && !blockEl.hasAttribute(TABLE_VIRTUAL_ID_ATTR)) {
        return blockEl;
    }

    const clone = blockEl.cloneNode(true) as Element;
    clone.querySelectorAll(`[${TABLE_VIRTUAL_ROWS_ATTR}]`).forEach((placeholder) => {
        const source = placeholder.getAttribute(TABLE_VIRTUAL_ROWS_ATTR) || "";
        if (!source) {
            placeholder.remove();
            return;
        }
        const template = document.createElement("template");
        template.innerHTML = source;
        placeholder.replaceWith(...Array.from(template.content.children));
    });
    clone.querySelectorAll(`[${TABLE_VIRTUAL_COLUMNS_ATTR}]`).forEach((holder) => {
        const source = holder.getAttribute(TABLE_VIRTUAL_COLUMNS_ATTR) || "";
        if (!source) {
            holder.remove();
            return;
        }
        const template = document.createElement("template");
        template.innerHTML = source;
        holder.replaceWith(...Array.from(template.content.children));
    });
    // 虚拟化标记是渲染缓存，写回前需清除
    clone.removeAttribute(TABLE_VIRTUAL_ID_ATTR);
    clone.querySelectorAll(`[${TABLE_VIRTUAL_ID_ATTR}]`).forEach((element) => {
        element.removeAttribute(TABLE_VIRTUAL_ID_ATTR);
    });
    return clone;
}

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
 * 把文本节点按顺序拼接为检索文本，并记录每个节点的区间。
 */
function assembleOwnText(nodes: Text[]): OwnTextNodes {
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

    return assembleOwnText(nodes);
}

/** 标题内不属正文的节点：块属性角标、标题图标、公式源码等 */
const SKIP_TITLE_TEXT_PARENT_SELECTOR =
    'style, script, .protyle-attr, .protyle-title__icon, .katex-mathml, [data-subtype="math"]:not([data-render="true"])';

/**
 * 标题的可编辑载体：普通标题与富文本标题都会带上这个类。
 * 富文本标题是一个完整的片段编辑器，里面还挂着预览、工具栏等隐藏面板，不能按整个标题元素取文本。
 */
const TITLE_INPUT_SELECTOR = ".protyle-title__input";

/** 标题内容区，去掉被外层内容区包住的内层 */
function getTitleInputs(titleEl: Element): Element[] {
    const inputs: Element[] = titleEl.classList.contains("protyle-title__input")
        ? [titleEl]
        : Array.from(titleEl.querySelectorAll(TITLE_INPUT_SELECTOR));
    return inputs.filter((input) => !inputs.some((other) => other !== input && other.contains(input)));
}

/**
 * 收集文档标题的文本节点。
 * 只取标题的可编辑载体：富文本标题的正文嵌在自身的片段编辑器段落（临时块 ID）里，因此不按 `[data-node-id]` 边界过滤。
 */
export function collectTitleTextNodes(titleEl: Element): OwnTextNodes {
    const nodes: Text[] = [];
    for (const input of getTitleInputs(titleEl)) {
        const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = (node as Text).parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                const content = node.textContent ?? "";
                if (!content || /^[\u200b\ufeff]+$/.test(content)) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (parent.closest(SKIP_TITLE_TEXT_PARENT_SELECTOR)) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (parent.closest('[aria-hidden="true"]') && !parent.closest("svg")) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            },
        });
        let current = walker.nextNode();
        while (current) {
            nodes.push(current as Text);
            current = walker.nextNode();
        }
    }

    return assembleOwnText(nodes);
}
