import { findBlockElement, isBlockVisuallyInDom } from "../block-dom";
import {
    inspectVisibleTextFromBlockElement,
    type VisibleTextInfo,
} from "../visible-text";
import { fetchVisibleTextsByDom } from "./fetch-doms";

/**
 * 解析候选块可见文本：已在编辑器且可见的走活 DOM；
 * 其余再批拉 getBlockDOMs 离屏提取。
 */
export async function resolveVisibleTexts(
    ids: string[],
    notebookId: string,
    protyleEl?: Element | null,
): Promise<Map<string, VisibleTextInfo>> {
    const result = new Map<string, VisibleTextInfo>();
    if (ids.length === 0) return result;

    const needFetch: string[] = [];
    for (const id of ids) {
        if (protyleEl) {
            const el = findBlockElement(protyleEl, id);
            if (isBlockVisuallyInDom(el)) {
                result.set(id, inspectVisibleTextFromBlockElement(el));
                continue;
            }
        }
        needFetch.push(id);
    }

    if (needFetch.length === 0) return result;

    const fetched = await fetchVisibleTextsByDom(needFetch, notebookId);
    for (const [id, info] of fetched) {
        result.set(id, info);
    }
    return result;
}
