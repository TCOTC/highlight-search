export async function waitForMath(root: Element, timeoutMs = 4000): Promise<void> {
    const start = Date.now();
    while (root.querySelector('[data-subtype="math"]:not([data-render="true"])')) {
        if (Date.now() - start > timeoutMs) break;
        await new Promise((resolve) => setTimeout(resolve, 40));
    }
}

/** 无 Protyle 时剔除未渲染公式，避免 LaTeX 源进入匹配 */
export function removeUnrenderedMath(host: Element): void {
    host.querySelectorAll('[data-subtype="math"]:not([data-render="true"])').forEach((el) => {
        el.remove();
    });
}
