import { fetchPost } from "siyuan";
import type { FindMatch } from "../find-match";
import { resolveDomHit } from "../highlight/resolve";
import { isReplaceable } from "./is-replaceable";
import { buildReplaceStringWithCasePreserved } from "./preserve-case";

export interface ApplyOccReplaceOptions {
    match: FindMatch;
    protyleEl: Element;
    source: object;
    /** 替换框原文 */
    replacement: string;
    preserveCase: boolean;
}

export type ApplyOccReplaceResult =
    | { ok: true; written: string }
    | { ok: false; reason: string };

/**
 * 在当前 Match 对应 Range 上替换一处文本，并 updateBlock 写回。
 */
export async function applyOccReplace(
    opts: ApplyOccReplaceOptions,
): Promise<ApplyOccReplaceResult> {
    const check = isReplaceable({
        match: opts.match,
        protyleEl: opts.protyleEl,
        source: opts.source,
    });
    if (!check.ok || !check.blockEl) {
        return { ok: false, reason: check.reason };
    }

    const hit = resolveDomHit(opts.source, opts.match);
    if (!hit) {
        return { ok: false, reason: "no-dom-hit" };
    }

    const range = hit.range;
    const matchedText = range.toString();
    const written = opts.preserveCase
        ? buildReplaceStringWithCasePreserved(matchedText, opts.replacement)
        : opts.replacement;

    const startEl =
        range.startContainer.nodeType === Node.TEXT_NODE
            ? (range.startContainer as Text).parentElement
            : (range.startContainer as Element | null);
    const refSpan = startEl?.closest(
        '[data-type~="block-ref"]',
    ) as HTMLElement | null;
    if (refSpan) {
        refSpan.setAttribute("data-subtype", "s");
    }

    if (!replaceRangeText(range, written)) {
        return { ok: false, reason: "replace-failed" };
    }

    const blockEl = check.blockEl;
    const id = blockEl.getAttribute("data-node-id");
    if (!id) {
        return { ok: false, reason: "block-missing" };
    }

    const data = blockEl.outerHTML;
    const ok = await updateBlockDom(id, data);
    if (!ok) {
        return { ok: false, reason: "update-failed" };
    }
    return { ok: true, written };
}

function replaceRangeText(range: Range, newText: string): boolean {
    try {
        const { startContainer, startOffset, endContainer, endOffset } = range;
        if (
            startContainer === endContainer &&
            startContainer.nodeType === Node.TEXT_NODE
        ) {
            const textNode = startContainer as Text;
            textNode.data =
                textNode.data.slice(0, startOffset) +
                newText +
                textNode.data.slice(endOffset);
            return true;
        }
        range.deleteContents();
        const node = document.createTextNode(newText);
        range.insertNode(node);
        return true;
    } catch {
        return false;
    }
}

function updateBlockDom(id: string, data: string): Promise<boolean> {
    return new Promise((resolve) => {
        fetchPost(
            "/api/block/updateBlock",
            {
                dataType: "dom",
                data,
                id,
            },
            (response: { code?: number }) => {
                resolve(response?.code === 0);
            },
        );
    });
}
