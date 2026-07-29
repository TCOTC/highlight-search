import { findBlockElement } from "../block-dom";
import type { FindMatch } from "../find-match";
import { resolveDomHit } from "../highlight/resolve";

/** 允许替换的叶子块 data-type */
export const REPLACEABLE_BLOCK_TYPES = new Set([
    "NodeParagraph",
    "NodeHeading",
    "NodeCodeBlock",
    "NodeTable",
]);

/** 允许的行内 data-type token（可组合） */
export const REPLACEABLE_INLINE_TOKENS = new Set([
    "text",
    "strong",
    "em",
    "u",
    "s",
    "mark",
    "sup",
    "sub",
    "kbd",
    "code",
    "a",
    "block-ref",
    "file-annotation-ref",
    "inline-memo",
    "tag",
    // 思源写回时按普通文本处理，不持久化为真实引用
    "virtual-block-ref",
]);

const DENIED_INLINE_TOKENS = new Set([
    "inline-math",
    "img",
]);

export type ReplaceableReason =
    | "ok"
    | "no-match"
    | "from-data-content"
    | "block-missing"
    | "block-type"
    | "code-render-node"
    | "no-dom-hit"
    | "in-embed"
    | "in-render-surface"
    | "inline-denied"
    | "contenteditable-false";

export interface ReplaceableResult {
    ok: boolean;
    reason: ReplaceableReason;
    /** 已解析到的块元素（ok 时必有） */
    blockEl?: HTMLElement;
    /** 已解析到的 DomHit Range 起点父元素（便于测试） */
    hitEl?: Element | null;
}

export interface IsReplaceableOptions {
    match: FindMatch | undefined;
    protyleEl: Element;
    source: object;
}

/**
 * 当前 Match 是否可安全做「替换当前」。
 * 须同时满足块白名单、行内白名单与硬条件，且能解析到 DomHit。
 */
export function isReplaceable(opts: IsReplaceableOptions): ReplaceableResult {
    const { match, protyleEl, source } = opts;
    if (!match) {
        return { ok: false, reason: "no-match" };
    }
    if (match.fromDataContent) {
        return { ok: false, reason: "from-data-content" };
    }

    const blockEl = findBlockElement(protyleEl, match.blockId) as HTMLElement | null;
    if (!blockEl) {
        return { ok: false, reason: "block-missing" };
    }

    const blockType = blockEl.getAttribute("data-type") || "";
    if (!REPLACEABLE_BLOCK_TYPES.has(blockType)) {
        return { ok: false, reason: "block-type" };
    }
    if (blockType === "NodeCodeBlock") {
        if (
            blockEl.classList.contains("render-node") ||
            !blockEl.classList.contains("code-block")
        ) {
            return { ok: false, reason: "code-render-node" };
        }
    }

    const hit = resolveDomHit(source, match);
    if (!hit) {
        return { ok: false, reason: "no-dom-hit" };
    }

    const startNode = hit.range.startContainer;
    const startEl =
        startNode.nodeType === Node.TEXT_NODE
            ? (startNode as Text).parentElement
            : (startNode as Element | null);
    if (!startEl || !blockEl.contains(startEl)) {
        return { ok: false, reason: "no-dom-hit" };
    }

    const context = checkHitContext(startEl, blockEl);
    if (context.ok === false) {
        return { ok: false, reason: context.reason, blockEl, hitEl: startEl };
    }

    if (blockType === "NodeTable") {
        if (!startEl.closest("th, td")) {
            return { ok: false, reason: "block-type", blockEl, hitEl: startEl };
        }
    }

    return { ok: true, reason: "ok", blockEl, hitEl: startEl };
}

function checkHitContext(
    startEl: Element,
    blockEl: HTMLElement,
): { ok: true } | { ok: false; reason: ReplaceableReason } {
    if (startEl.closest('[data-type="NodeBlockQueryEmbed"]')) {
        return { ok: false, reason: "in-embed" };
    }
    if (
        startEl.closest(
            "svg, .katex, .katex-html, .katex-mathml, [data-subtype='math']",
        )
    ) {
        return { ok: false, reason: "in-render-surface" };
    }

    let node: Element | null = startEl;
    while (node && node !== blockEl) {
        const dataType = node.getAttribute?.("data-type");
        if (dataType) {
            const tokens = dataType.split(/\s+/).filter(Boolean);
            for (const t of tokens) {
                if (DENIED_INLINE_TOKENS.has(t)) {
                    return { ok: false, reason: "inline-denied" };
                }
            }
            // 行内 mark：所有 token 须在白名单（可与其它白名单 token 组合）
            if (node.tagName === "SPAN" && tokens.length > 0) {
                const allAllowed = tokens.every((t) => REPLACEABLE_INLINE_TOKENS.has(t));
                if (!allAllowed) {
                    // 非行内 mark 的 data-type（少见）或含未知 token
                    const hasDenied = tokens.some((t) => !REPLACEABLE_INLINE_TOKENS.has(t));
                    if (hasDenied) {
                        return { ok: false, reason: "inline-denied" };
                    }
                }
            }
        }

        if (
            node instanceof HTMLElement &&
            node.isContentEditable === false &&
            node.getAttribute("contenteditable") === "false"
        ) {
            const dt = node.getAttribute("data-type") || "";
            const tokens = dt.split(/\s+/).filter(Boolean);
            const allowedShell =
                node.tagName === "SPAN" &&
                tokens.length > 0 &&
                tokens.every((t) => REPLACEABLE_INLINE_TOKENS.has(t));
            if (!allowedShell) {
                return { ok: false, reason: "contenteditable-false" };
            }
        }

        node = node.parentElement;
    }

    return { ok: true };
}

/** 给 UI / i18n 用的简短原因 key（映射到 i18n） */
export function replaceableReasonI18nKey(reason: ReplaceableReason): string {
    switch (reason) {
        case "ok":
            return "replace";
        case "from-data-content":
        case "code-render-node":
        case "in-render-surface":
        case "inline-denied":
        case "in-embed":
        case "contenteditable-false":
        case "block-type":
            return "replaceUnsupported";
        case "no-match":
        case "block-missing":
        case "no-dom-hit":
            return "replaceUnavailable";
        default:
            return "replaceUnsupported";
    }
}
