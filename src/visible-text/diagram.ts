/**
 * 思源 mermaid / flowchart 在脚本加载后用 firstElementChild.clientWidth === 0
 * 判断「折叠隐藏」；宽为 0 时只挂 MutationObserver，离屏宿主会永远不 init。
 * @see siyuan app/src/protyle/render/mermaidRender.ts
 */
export const DIAGRAM_SUBTYPE_SELECTOR =
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

export const OFFSCREEN_LAYOUT_WIDTH_PX = 800;

/**
 * 满足官方 mermaidRender / flowchartRender 的「可见」宽度检查，避免进 hideElements 死等。
 */
export function ensureDiagramBlocksHaveWidth(host: HTMLElement): void {
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

/**
 * mermaid / flowchart 在 init 里先打 data-render 再 await 画图，故以 svg / 错误节点为准。
 */
export async function waitForDiagramOutputs(root: Element, timeoutMs = 6000): Promise<void> {
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
