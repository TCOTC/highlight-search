import { fetchSyncPost } from "siyuan";
import {
    inspectVisibleTextFromBlockDom,
    type VisibleTextInfo,
} from "../visible-text";

const DOM_BATCH_SIZE = 64;
const DOM_BATCH_CONCURRENCY = 4;

async function fetchBlockDoms(
    batch: string[],
    notebookId: string,
): Promise<Record<string, string>> {
    const body: Record<string, unknown> = { ids: batch };
    if (notebookId) {
        body.notebook = notebookId;
    }

    try {
        const response = await fetchSyncPost("/api/block/getBlockDOMsWithEmbed", body);
        if (response.code === 0 && response.data && typeof response.data === "object") {
            return response.data as Record<string, string>;
        }
    } catch {
        // 回退到 getBlockDOMs
    }

    try {
        const response = await fetchSyncPost("/api/block/getBlockDOMs", body);
        if (response.code === 0 && response.data && typeof response.data === "object") {
            return response.data as Record<string, string>;
        }
    } catch {
        // 单批失败由调用方填空串
    }
    return {};
}

/**
 * 批量 getBlockDOMs(WithEmbed) → 离屏渲染 → 可见文本。
 * 加密笔记本需传 notebook。
 */
export async function fetchVisibleTextsByDom(
    ids: string[],
    notebookId: string,
): Promise<Map<string, VisibleTextInfo>> {
    const result = new Map<string, VisibleTextInfo>();
    if (ids.length === 0) return result;

    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += DOM_BATCH_SIZE) {
        batches.push(ids.slice(i, i + DOM_BATCH_SIZE));
    }

    async function processBatch(batch: string[]): Promise<void> {
        try {
            const doms = await fetchBlockDoms(batch, notebookId);
            await Promise.all(
                batch.map(async (id) => {
                    result.set(id, await inspectVisibleTextFromBlockDom(doms[id] || ""));
                }),
            );
        } catch {
            for (const id of batch) {
                if (!result.has(id)) {
                    result.set(id, { text: "", fromDataContent: false });
                }
            }
        }
    }

    for (let i = 0; i < batches.length; i += DOM_BATCH_CONCURRENCY) {
        const chunk = batches.slice(i, i + DOM_BATCH_CONCURRENCY);
        await Promise.all(chunk.map((batch) => processBatch(batch)));
    }
    return result;
}
