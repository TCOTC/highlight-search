import { OFFSCREEN_LAYOUT_WIDTH_PX } from "./diagram";

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

export function getProtyleRenderer(): ProtyleRenderer | null {
    const win = window as Window & { Protyle?: ProtyleRenderer };
    return win.Protyle ?? null;
}

export function createOffscreenHost(): HTMLElement {
    const host = document.createElement("div");
    host.className = "protyle-wysiwyg";
    // 需非 0 布局宽供官方 clientWidth 检查；勿 max-height/overflow 裁切，否则抽文本会被当成 layout 隐藏
    host.style.cssText =
        `position:fixed;left:-${OFFSCREEN_LAYOUT_WIDTH_PX * 2}px;top:0;` +
        `width:${OFFSCREEN_LAYOUT_WIDTH_PX}px;pointer-events:none;opacity:0;z-index:-1`;
    document.body.appendChild(host);
    return host;
}

export function callRenders(host: Element): void {
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
