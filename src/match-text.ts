/**
 * 共享的文本匹配规则：Match 列表扫描与 DOM 高亮必须一致。
 */

/** 大小写模式：跟随思源 / 强制区分 / 强制不区分 */
export type CaseSensitiveMode = "follow" | "on" | "off";

/**
 * 规范化搜索词：含非空白时去掉首尾空白；纯空白则保留
 * https://github.com/TCOTC/highlight-search/issues/4
 */
export function normalizeSearchValue(value: string): string {
    if (!value) return "";
    const trimmed = value.trim();
    return trimmed || value;
}

/** 解析实际是否区分大小写 */
export function resolveCaseSensitive(mode: CaseSensitiveMode): boolean {
    if (mode === "on") return true;
    if (mode === "off") return false;
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
 * 在 haystack 中找出 needle 的全部非重叠出现（按与 DOM 高亮相同的变体规则）。
 * 返回的是相对 haystack 原文字符的 [start, end)。
 */
export function findMatchSpans(
    haystack: string,
    needle: string,
    caseSensitive: boolean,
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
): number {
    return findMatchSpans(haystack, needle, caseSensitive).length;
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

/** 从已知 span 截取 snippet，尽量以匹配处居中 */
export function makeSnippetFromSpan(content: string, span: TextSpan, radius = 24): string {
    const start = Math.max(0, span.start - radius);
    const end = Math.min(content.length, span.end + radius);
    let snippet = content.slice(start, end).replace(/\s+/g, " ").trim();
    if (start > 0) snippet = "…" + snippet;
    if (end < content.length) snippet = snippet + "…";
    return snippet;
}

/** 从 content 截取 snippet，尽量以匹配处居中 */
export function makeSnippet(content: string, occ: number, needle: string, caseSensitive: boolean, radius = 24): string {
    const spans = findMatchSpans(content, needle, caseSensitive);
    const span = spans[occ];
    if (!span) {
        return content.slice(0, radius * 2).replace(/\s+/g, " ").trim();
    }
    return makeSnippetFromSpan(content, span, radius);
}
