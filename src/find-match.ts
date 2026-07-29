import type { TextSpan } from "./match-text";

/** 文档内一处匹配（跨卸载仍稳定） */
export interface FindMatch {
    blockId: string;
    /** 该块内第几次出现（0-based）；按块合并时固定为 0 */
    occ: number;
    snippet?: string;
    /** 本条在 snippet 中需 mark 的全部区间（可多处） */
    snippetMatches?: TextSpan[];
    /**
     * 是否来自 data-content 回退（无稳定词级 DOM）。
     * 为 true 时不可替换。
     */
    fromDataContent?: boolean;
}
