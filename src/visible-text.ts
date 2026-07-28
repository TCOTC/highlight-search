/**
 * 从块 DOM HTML 提取「能直接看到的」文本。
 * data-href 等属性不会进入 textContent；并剔除 .protyle-attr / style / script。
 */
export function visibleTextFromBlockDom(domHtml: string): string {
    if (!domHtml) return "";
    const wrap = document.createElement("div");
    wrap.innerHTML = domHtml;
    wrap.querySelectorAll(".protyle-attr, style, script").forEach((el) => el.remove());
    // 与编辑器可见文案一致：不包含属性里的 URL
    return wrap.textContent ?? "";
}
