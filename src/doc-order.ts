/**
 * 从文档 Block DOM HTML 中按出现顺序建立块 ID → 阅读序索引。
 * 不依赖 /api/block/getBlocksIndexes（其对列表内嵌套段落会返回相同索引）。
 */
export function buildDocOrderIndexFromHtml(
    domHtml: string,
    neededIds?: Set<string>,
): Map<string, number> {
    const indexMap = new Map<string, number>();
    if (!domHtml) return indexMap;

    const wrap = document.createElement("div");
    wrap.innerHTML = domHtml;
    let i = 0;
    wrap.querySelectorAll("[data-node-id]").forEach((el) => {
        const id = el.getAttribute("data-node-id");
        if (!id || indexMap.has(id)) return;
        if (neededIds && !neededIds.has(id)) return;
        indexMap.set(id, i);
        i += 1;
    });
    return indexMap;
}
