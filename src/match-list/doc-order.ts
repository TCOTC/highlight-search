import { fetchSyncPost } from "siyuan";

/**
 * 拉取文档内全部块的深度优先原文序。
 * 失败返回空数组。
 */
export async function fetchDocBlocksOrders(rootId: string): Promise<string[]> {
    if (!rootId) return [];
    try {
        const response = await fetchSyncPost("/api/block/getDocBlocksOrders", { id: rootId });
        if (response.code !== 0 || !Array.isArray(response.data)) {
            return [];
        }
        return response.data as string[];
    } catch {
        return [];
    }
}

/**
 * 按文档阅读序排列候选 ID。
 * 单次扫描 docOrder（O(N)），避免对子集再 sort。
 */
export function orderIdsByDocOrder(ids: string[], docOrder: string[]): string[] {
    if (ids.length <= 1 || docOrder.length === 0) return ids;

    const needed = new Set(ids);
    const ordered: string[] = [];
    for (const id of docOrder) {
        if (!needed.has(id)) continue;
        ordered.push(id);
        needed.delete(id);
        if (needed.size === 0) break;
    }
    if (needed.size > 0) {
        for (const id of ids) {
            if (needed.has(id)) ordered.push(id);
        }
    }
    return ordered;
}
