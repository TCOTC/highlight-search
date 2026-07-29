/**
 * 共享的文本匹配规则：Match 列表扫描与 DOM 高亮必须一致。
 */

/**
 * 规范化搜索词：含非空白时去掉首尾空白；纯空白则保留
 * https://github.com/TCOTC/highlight-search/issues/4
 */
export function normalizeSearchValue(value: string): string {
    if (!value) return "";
    const trimmed = value.trim();
    return trimmed || value;
}

/** 读取思源「设置 → 搜索」中的区分大小写开关，作为搜索框默认值 */
export function getSiYuanCaseSensitive(): boolean {
    return !!(window as any).siyuan?.config?.search?.caseSensitive;
}

/** 按大小写规则比较用的字符串 */
export function forCompare(text: string, caseSensitive: boolean): string {
    return caseSensitive ? text : text.toLowerCase();
}

/**
 * 生成搜索关键词变体（空白 / 零宽字符）
 * https://github.com/TCOTC/highlight-search/issues/42
 */
export function generateSearchVariants(searchStr: string): string[] {
    if (!searchStr) return [];
    const variants = [searchStr];
    const trimmed = searchStr.trim();
    if (trimmed && trimmed !== searchStr) {
        variants.push(trimmed);
    }
    const noZeroWidth = searchStr.replace(/[\u200B-\u200D\uFEFF]/g, "");
    if (noZeroWidth !== searchStr) {
        variants.push(noZeroWidth);
    }
    const noWhitespace = searchStr.replace(/\s/g, "");
    if (noWhitespace !== searchStr && noWhitespace.length > 0) {
        variants.push(noWhitespace);
    }
    return [...new Set(variants)];
}

export type TextSpan = { start: number; end: number };

/**
 * VS Code / Monaco 默认单词分隔符（不含空白；空白单独视为分隔）。
 * https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/core/wordHelper.ts
 */
const DEFAULT_WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";

/** 是否为「单词字符」（非空白且不在默认分隔符中），用于全字匹配边界判断 */
export function isWordChar(ch: string): boolean {
    if (!ch) return false;
    if (/\s/.test(ch)) return false;
    return !DEFAULT_WORD_SEPARATORS.includes(ch);
}

/**
 * 判断 [start, end) 是否为全字匹配（对齐 VS Code Match Whole Word）。
 * 左右边界须为字符串端点或非单词字符。
 */
export function isWholeWordMatch(text: string, start: number, end: number): boolean {
    if (start < 0 || end > text.length || start >= end) return false;
    if (start > 0 && isWordChar(text[start - 1])) return false;
    if (end < text.length && isWordChar(text[end])) return false;
    return true;
}

/**
 * 在 haystack 中找出 needle 的全部非重叠出现（按与 DOM 高亮相同的变体规则）。
 * 返回的是相对 haystack 原文字符的 [start, end)。
 * @param wholeWord 全字匹配；默认 false
 */
export function findMatchSpans(
    haystack: string,
    needle: string,
    caseSensitive: boolean,
    wholeWord = false,
): TextSpan[] {
    const normalizedNeedle = normalizeSearchValue(needle);
    if (!normalizedNeedle || !haystack) return [];

    const compareHay = forCompare(haystack, caseSensitive);
    const variants = generateSearchVariants(normalizedNeedle).map((v) =>
        forCompare(v, caseSensitive),
    );

    const allMatches: TextSpan[] = [];
    const processed = new Set<string>();

    for (const searchStr of variants) {
        if (!searchStr) continue;
        let startIndex = 0;
        while ((startIndex = compareHay.indexOf(searchStr, startIndex)) !== -1) {
            const endIndex = startIndex + searchStr.length;
            allMatches.push({ start: startIndex, end: endIndex });
            startIndex = endIndex;
        }

        // 文档侧可能含零宽字符：在去零宽文本上匹配后再映回原文
        const normalizedDoc = compareHay.replace(/[\u200B-\u200D\uFEFF]/g, "");
        const normalizedSearch = searchStr.replace(/[\u200B-\u200D\uFEFF]/g, "");
        if (normalizedSearch !== searchStr || normalizedDoc !== compareHay) {
            startIndex = 0;
            while ((startIndex = normalizedDoc.indexOf(normalizedSearch, startIndex)) !== -1) {
                const endNorm = startIndex + normalizedSearch.length;
                const originalStart = mapNormalizedIndex(compareHay, normalizedDoc, startIndex);
                const originalEnd = mapNormalizedIndex(compareHay, normalizedDoc, endNorm);
                if (originalStart !== -1 && originalEnd !== -1) {
                    allMatches.push({ start: originalStart, end: originalEnd });
                }
                startIndex = endNorm;
            }
        }
    }

    allMatches.sort((a, b) => a.start - b.start);

    const spans: TextSpan[] = [];
    for (const match of allMatches) {
        if (wholeWord && !isWholeWordMatch(haystack, match.start, match.end)) {
            continue;
        }
        let overlapping = false;
        for (const key of processed) {
            const [procStart, procEnd] = key.split("-").map(Number);
            if (match.start < procEnd && match.end > procStart) {
                overlapping = true;
                break;
            }
        }
        if (!overlapping) {
            processed.add(`${match.start}-${match.end}`);
            spans.push(match);
        }
    }
    return spans;
}

/** 统计出现次数（与 findMatchSpans 一致） */
export function countOccurrences(
    haystack: string,
    needle: string,
    caseSensitive: boolean,
    wholeWord = false,
): number {
    return findMatchSpans(haystack, needle, caseSensitive, wholeWord).length;
}

/** 去零宽后的下标映回原文下标 */
function mapNormalizedIndex(
    originalText: string,
    _normalizedText: string,
    normalizedIndex: number,
): number {
    let originalIndex = 0;
    let normalizedIndexCount = 0;
    while (originalIndex < originalText.length && normalizedIndexCount < normalizedIndex) {
        if (!/[\u200B-\u200D\uFEFF]/.test(originalText[originalIndex])) {
            normalizedIndexCount++;
        }
        originalIndex++;
    }
    if (normalizedIndexCount === normalizedIndex && originalIndex <= originalText.length) {
        while (
            originalIndex < originalText.length &&
            /[\u200B-\u200D\uFEFF]/.test(originalText[originalIndex])
        ) {
            originalIndex++;
        }
        return originalIndex;
    }
    return -1;
}

/** 从已知 span 截取的 snippet，并带上该命中在 snippet 内的区间 */
export type Snippet = {
    text: string;
    /** 本条命中在 text 中的 [start, end) */
    matchStart: number;
    matchEnd: number;
};

/** 覆盖多处命中的 snippet，matches 为各命中在 text 中的区间 */
export type MultiSnippet = {
    text: string;
    matches: TextSpan[];
};

/**
 * 折叠连续空白为单空格，并建立原文下标 → 折叠后下标的映射。
 * map[i] 表示原文位置 i（含 length）对应折叠串中的下标。
 */
function collapseWsWithMap(raw: string): { text: string; map: number[] } {
    const chars: string[] = [];
    const map = new Array<number>(raw.length + 1);
    let collapsed = 0;
    let i = 0;
    while (i < raw.length) {
        if (/\s/.test(raw[i])) {
            while (i < raw.length && /\s/.test(raw[i])) {
                map[i] = collapsed;
                i++;
            }
            chars.push(" ");
            collapsed++;
        } else {
            map[i] = collapsed;
            chars.push(raw[i]);
            collapsed++;
            i++;
        }
    }
    map[raw.length] = collapsed;
    return { text: chars.join(""), map };
}

/** 从已知 span 截取 snippet，尽量以匹配处居中 */
export function makeSnippetFromSpan(content: string, span: TextSpan, radius = 24): Snippet {
    const sliceStart = Math.max(0, span.start - radius);
    const sliceEnd = Math.min(content.length, span.end + radius);
    const raw = content.slice(sliceStart, sliceEnd);
    const { text: collapsed, map } = collapseWsWithMap(raw);

    const trimStart = collapsed.length - collapsed.trimStart().length;
    const trimEndLen = collapsed.length - collapsed.trimEnd().length;
    let text = collapsed.slice(trimStart, collapsed.length - trimEndLen);

    let matchStart = map[span.start - sliceStart] - trimStart;
    let matchEnd = map[span.end - sliceStart] - trimStart;
    matchStart = Math.max(0, Math.min(matchStart, text.length));
    matchEnd = Math.max(matchStart, Math.min(matchEnd, text.length));

    if (sliceStart > 0) {
        text = "…" + text;
        matchStart += 1;
        matchEnd += 1;
    }
    if (sliceEnd < content.length) {
        text = text + "…";
    }
    return { text, matchStart, matchEnd };
}

/**
 * 从多处 span 截取一条 snippet，尽量覆盖首尾命中并标出窗口内全部命中。
 * 用于无法词级定位、按块合并的 Match（如 PlantUML data-content）。
 */
export function makeSnippetFromSpans(
    content: string,
    spans: TextSpan[],
    radius = 24,
): MultiSnippet {
    if (spans.length === 0) {
        return { text: "", matches: [] };
    }
    if (spans.length === 1) {
        const one = makeSnippetFromSpan(content, spans[0], radius);
        return {
            text: one.text,
            matches: [{ start: one.matchStart, end: one.matchEnd }],
        };
    }

    const first = spans[0];
    const last = spans[spans.length - 1];
    const sliceStart = Math.max(0, first.start - radius);
    const sliceEnd = Math.min(content.length, last.end + radius);
    const raw = content.slice(sliceStart, sliceEnd);
    const { text: collapsed, map } = collapseWsWithMap(raw);

    const trimStart = collapsed.length - collapsed.trimStart().length;
    const trimEndLen = collapsed.length - collapsed.trimEnd().length;
    let text = collapsed.slice(trimStart, collapsed.length - trimEndLen);

    const matches: TextSpan[] = [];
    for (const span of spans) {
        if (span.end <= sliceStart || span.start >= sliceEnd) continue;
        let matchStart = map[span.start - sliceStart] - trimStart;
        let matchEnd = map[span.end - sliceStart] - trimStart;
        matchStart = Math.max(0, Math.min(matchStart, text.length));
        matchEnd = Math.max(matchStart, Math.min(matchEnd, text.length));
        if (matchStart < matchEnd) {
            matches.push({ start: matchStart, end: matchEnd });
        }
    }

    if (sliceStart > 0) {
        text = "…" + text;
        for (const m of matches) {
            m.start += 1;
            m.end += 1;
        }
    }
    if (sliceEnd < content.length) {
        text = text + "…";
    }
    return { text, matches };
}

/** 从 content 截取 snippet，尽量以匹配处居中 */
export function makeSnippet(
    content: string,
    occ: number,
    needle: string,
    caseSensitive: boolean,
    radius = 24,
    wholeWord = false,
): string {
    const spans = findMatchSpans(content, needle, caseSensitive, wholeWord);
    const span = spans[occ];
    if (!span) {
        return content.slice(0, radius * 2).replace(/\s+/g, " ").trim();
    }
    return makeSnippetFromSpan(content, span, radius).text;
}
