/**
 * 生成搜索关键词的变体，解决 Issue #42：同时搜索包含空白字符和不包含空白字符的结果
 */
export function generateSearchVariants(searchStr: string): string[] {
    if (!searchStr) return [];
    const variants = [searchStr];
    // 去除前后空白字符的变体
    const trimmed = searchStr.trim();
    if (trimmed !== searchStr) {
        variants.push(trimmed);
    }
    // 去除零宽空格和零宽连字的变体
    const noZeroWidth = searchStr.replace(/[\u200B-\u200D\uFEFF]/g, '');
    if (noZeroWidth !== searchStr) {
        variants.push(noZeroWidth);
    }
    // 去除所有空白字符的变体
    const noWhitespace = searchStr.replace(/\s/g, '');
    if (noWhitespace !== searchStr && noWhitespace.length > 0) {
        variants.push(noWhitespace);
    }
    return [...new Set(variants)];
}

/** 检查元素是否可见，使用最新的 checkVisibility() API */
function isElementVisible(element: Element | null): boolean {
    if (!element) return false;
    const htmlElement = element as HTMLElement;
    if (htmlElement.tagName?.toLowerCase() === 'style') {
        return false;
    }
    // 检查元素及其所有祖先元素是否有 fn__none 类（思源笔记用于隐藏元素的类，包括折叠的块）
    let current: Element | null = element;
    while (current && current !== document.body) {
        if ((current as HTMLElement).classList?.contains('fn__none')) {
            return false;
        }
        current = current.parentElement;
    }
    if (typeof htmlElement.checkVisibility === 'function') {
        return htmlElement.checkVisibility({
            visibilityProperty: true,
            opacityProperty: true,
        });
    }
    // 回退到手动检查
    const style = window.getComputedStyle(htmlElement);
    if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
    }
    return isElementVisible(htmlElement.parentElement);
}

/** 将标准化后的位置转换为原始文档中的位置 */
function findOriginalPosition(originalText: string, normalizedText: string, normalizedIndex: number): number {
    let originalIndex = 0;
    let normalizedIndexCount = 0;
    while (originalIndex < originalText.length && normalizedIndexCount < normalizedIndex) {
        if (!/[\u200B-\u200D\uFEFF]/.test(originalText[originalIndex])) {
            normalizedIndexCount++;
        }
        originalIndex++;
    }
    if (normalizedIndexCount === normalizedIndex && originalIndex <= originalText.length) {
        const remainingOriginal = originalText.slice(originalIndex).replace(/[\u200B-\u200D\uFEFF]/g, '');
        const remainingNormalized = normalizedText.slice(normalizedIndex);
        if (remainingOriginal.startsWith(remainingNormalized.substring(0, Math.min(remainingOriginal.length, remainingNormalized.length)))) {
            while (originalIndex < originalText.length && /[\u200B-\u200D\uFEFF]/.test(originalText[originalIndex])) {
                originalIndex++;
            }
            return originalIndex;
        }
    }
    return -1;
}

/** 为指定位置创建 Range */
function createRangeForPosition(
    startIndex: number,
    endIndex: number,
    cur_nodeIdx: number,
    allTextNodes: Text[],
    incr_lens: number[],
    processedRanges: Set<string>,
    ranges: Range[],
): boolean {
    try {
        const range = document.createRange();
        // incr_lens[i] 是到第 i 个节点（包含）为止的累计长度
        let startNodeIdx = cur_nodeIdx;
        while (startNodeIdx < allTextNodes.length - 1 && incr_lens[startNodeIdx] <= startIndex) {
            startNodeIdx++;
        }
        const startNode = allTextNodes[startNodeIdx];
        const startOffset = startIndex - (startNodeIdx > 0 ? incr_lens[startNodeIdx - 1] : 0);
        const startNodeLen = startNode.textContent.length;
        if (startOffset < 0 || startOffset > startNodeLen) {
            return false;
        }
        let endNodeIdx = startNodeIdx;
        while (endNodeIdx < allTextNodes.length - 1 && incr_lens[endNodeIdx] < endIndex) {
            endNodeIdx++;
        }
        const endNode = allTextNodes[endNodeIdx];
        const endOffset = endIndex - (endNodeIdx > 0 ? incr_lens[endNodeIdx - 1] : 0);
        const endNodeLen = endNode.textContent.length;
        if (endOffset < 0 || endOffset > endNodeLen) {
            return false;
        }
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        const startContainerElement = startNode.parentElement;
        const endContainerElement = endNode.parentElement;
        if (startContainerElement && endContainerElement &&
            isElementVisible(startContainerElement) && isElementVisible(endContainerElement)) {
            ranges.push(range);
            processedRanges.add(`${startIndex}-${endIndex}`);
            return true;
        }
    } catch (error) {
        console.error("Error setting range in node:", error);
    }
    return false;
}

/** 获取当前编辑区对应的文档根节点 */
export function getDocRoot(edit: Element): HTMLElement | null {
    // 选择器1：桌面端正常打开的页签文档（直接子元素查找）
    let docRoot = edit.querySelector(':scope > .protyle:not(.fn__none) :is(.protyle-content:not(.fn__none) .protyle-wysiwyg, .protyle-preview:not(.fn__none) .b3-typography)') as HTMLElement;
    // 选择器2：桌面端浮窗和搜索窗口、移动端编辑器（内部查找，不限制为直接子元素）
    if (!docRoot) {
        docRoot = edit.querySelector('.protyle:not(.fn__none) :is(.protyle-content:not(.fn__none) .protyle-wysiwyg, .protyle-preview:not(.fn__none) .b3-typography)') as HTMLElement;
    }
    return docRoot || null;
}

/**
 * 在编辑区内计算搜索结果 Range 列表（不执行高亮）
 */
export function calculateSearchResults(edit: Element, value: string): Range[] {
    const str = value.trim().toLowerCase();
    if (!str) {
        return [];
    }

    const docRoot = getDocRoot(edit);
    if (!docRoot) {
        return [];
    }

    const docText = docRoot.textContent.toLowerCase();

    // 准备一个数组来保存所有文本节点
    const allTextNodes: Text[] = [];
    const incr_lens: number[] = [];
    let cur_len0 = 0;
    const treeWalker = document.createTreeWalker(docRoot, NodeFilter.SHOW_TEXT);
    let currentNode = treeWalker.nextNode();
    while (currentNode) {
        allTextNodes.push(currentNode as Text);
        cur_len0 += currentNode.textContent.length;
        incr_lens.push(cur_len0);
        currentNode = treeWalker.nextNode();
    }

    const searchVariants = generateSearchVariants(str);
    const ranges: Range[] = [];
    // 双向匹配：不仅搜索关键词变体，还要考虑文档内容可能包含零宽空格的情况
    const processedRanges = new Set<string>();
    const allMatches: Array<{startIndex: number, endIndex: number, searchStr: string}> = [];

    searchVariants.forEach((searchStr) => {
        let startIndex = 0;
        let endIndex = 0;
        // 方法1：直接搜索当前变体
        while ((startIndex = docText.indexOf(searchStr, startIndex)) !== -1) {
            endIndex = startIndex + searchStr.length;
            allMatches.push({startIndex, endIndex, searchStr});
            startIndex = endIndex;
        }
        // 方法2：搜索去除零宽空格后的文档内容
        const normalizedDocText = docText.replace(/[\u200B-\u200D\uFEFF]/g, '');
        const normalizedSearchStr = searchStr.replace(/[\u200B-\u200D\uFEFF]/g, '');
        if (normalizedSearchStr !== searchStr || normalizedDocText !== docText) {
            startIndex = 0;
            while ((startIndex = normalizedDocText.indexOf(normalizedSearchStr, startIndex)) !== -1) {
                endIndex = startIndex + normalizedSearchStr.length;
                const originalStartIndex = findOriginalPosition(docText, normalizedDocText, startIndex);
                const originalEndIndex = findOriginalPosition(docText, normalizedDocText, endIndex);
                if (originalStartIndex !== -1 && originalEndIndex !== -1) {
                    allMatches.push({startIndex: originalStartIndex, endIndex: originalEndIndex, searchStr});
                }
                startIndex = endIndex;
            }
        }
    });

    // 按起始位置排序，确保搜索结果索引顺序正确
    allMatches.sort((a, b) => a.startIndex - b.startIndex);

    // 去重并创建 Range
    allMatches.forEach((match) => {
        let isOverlapping = false;
        for (const processedRange of processedRanges) {
            const [procStart, procEnd] = processedRange.split('-').map(Number);
            if (match.startIndex < procEnd && match.endIndex > procStart) {
                isOverlapping = true;
                break;
            }
        }
        if (!isOverlapping) {
            createRangeForPosition(match.startIndex, match.endIndex, 0, allTextNodes, incr_lens, processedRanges, ranges);
        }
    });

    return ranges;
}

export function clearHighlight() {
    CSS.highlights.delete("search-results");
    CSS.highlights.delete("search-focus");
}

export function applySearchHighlights(ranges: Range[]) {
    clearHighlight();
    if (ranges.length === 0) {
        return;
    }
    const searchResultsHighlight = new Highlight(...ranges);
    CSS.highlights.set("search-results", searchResultsHighlight);
}

export function applyFocusHighlight(range: Range) {
    CSS.highlights.set("search-focus", new Highlight(range));
}

/**
 * 查找包含指定元素的所有滚动容器（从最内层到最外层）
 * 支持垂直和横向滚动容器
 */
export function findScrollContainers(element: Element): HTMLElement[] {
    const containers: HTMLElement[] = [];
    let current: Element | null = element;
    while (current && current !== document.body) {
        const htmlElement = current as HTMLElement;
        const overflowY = window.getComputedStyle(htmlElement).overflowY;
        const overflowX = window.getComputedStyle(htmlElement).overflowX;
        const canScrollY = (overflowY === 'auto' || overflowY === 'scroll') &&
                          htmlElement.scrollHeight > htmlElement.clientHeight;
        const canScrollX = (overflowX === 'auto' || overflowX === 'scroll') &&
                          htmlElement.scrollWidth > htmlElement.clientWidth;
        if (canScrollY || canScrollX) {
            containers.push(htmlElement);
        }
        current = current.parentElement;
    }
    return containers;
}

/**
 * 滚动容器以使 range 可见并尽量居中（支持垂直和横向滚动）
 */
export function scrollContainerToRange(range: Range, container: HTMLElement) {
    const rangeRect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const containerStyle = window.getComputedStyle(container);
    const rangeCenterX = (rangeRect.left + rangeRect.right) / 2;
    const overflowY = containerStyle.overflowY;
    const overflowX = containerStyle.overflowX;
    const canScrollY = (overflowY === 'auto' || overflowY === 'scroll') && container.scrollHeight > container.clientHeight;
    const canScrollX = (overflowX === 'auto' || overflowX === 'scroll') && container.scrollWidth > container.clientWidth;
    if (canScrollY) {
        const rangeCenterY = (rangeRect.top + rangeRect.bottom) / 2;
        const rangeCenterYInContent = rangeCenterY - containerRect.top + container.scrollTop;
        const targetScrollTop = rangeCenterYInContent - container.clientHeight / 2;
        const maxScrollTop = container.scrollHeight - container.clientHeight;
        const minScrollTop = 0;
        container.scrollTop = Math.max(minScrollTop, Math.min(targetScrollTop, maxScrollTop));
    }
    if (canScrollX) {
        const rangeCenterXInContent = rangeCenterX - containerRect.left + container.scrollLeft;
        const targetScrollLeft = rangeCenterXInContent - container.clientWidth / 2;
        const maxScrollLeft = container.scrollWidth - container.clientWidth;
        const minScrollLeft = 0;
        container.scrollLeft = Math.max(minScrollLeft, Math.min(targetScrollLeft, maxScrollLeft));
    }
}

/**
 * 滚动到指定结果并设置焦点高亮
 */
export function scrollIntoRanges(
    edit: Element,
    ranges: Range[],
    index: number,
    scroll: boolean = true,
) {
    if (!ranges || ranges.length === 0) {
        return;
    }
    const range = ranges[index];
    if (scroll) {
        const commonAncestor = range.commonAncestorContainer;
        const ancestorElement = commonAncestor.nodeType === Node.TEXT_NODE
            ? commonAncestor.parentElement
            : commonAncestor as Element;
        if (ancestorElement) {
            const scrollContainers = findScrollContainers(ancestorElement);
            scrollContainers.forEach(container => {
                scrollContainerToRange(range, container);
            });
            if (scrollContainers.length === 0) {
                const docContentElement = edit.querySelector(':scope > .protyle:not(.fn__none) :is(.protyle-content:not(.fn__none), .protyle-preview:not(.fn__none))') as HTMLElement;
                if (docContentElement) {
                    scrollContainerToRange(range, docContentElement);
                }
            }
        }
    }
    applyFocusHighlight(range);
}

/**
 * 计算并高亮搜索结果，返回 Range 列表
 */
export function highlightHitResult(edit: Element, value: string): Range[] {
    const ranges = calculateSearchResults(edit, value);
    if (ranges.length === 0) {
        clearHighlight();
        return [];
    }
    applySearchHighlights(ranges);
    return ranges;
}
