import { isMobile } from "./index";

const PLACEHOLDER = "🔍︎ (Shift) + Enter";

export class Search {
    private edit: Element;
    private element: Element;
    private plugin: any;
    private input: HTMLInputElement;
    private countEl: HTMLSpanElement;

    private searchText = "";
    private resultCount = 0;
    private resultIndex = 0;
    private resultRange: Range[] = [];

    private typingTimer: number | undefined;
    private readonly doneTypingInterval = 400;

    constructor(opts: { edit: Element; element: Element; plugin: any; presetText?: string }) {
        this.edit = opts.edit;
        this.element = opts.element;
        this.plugin = opts.plugin;

        this.element.innerHTML = `
            <div class="search-dialog">
                <div class="b3-form__icon search-input">
                    <input type="text" class="b3-text-field fn__size200" spellcheck="false" placeholder="${PLACEHOLDER}" />
                </div>
                <span class="search-count${!isMobile() ? ' search-count--draggable' : ''}">0/0</span>
                <div class="search-tools">
                    <div class="js-last"><svg class="icon--14_14"><use xlink:href="#iconUp"/></svg></div>
                    <div class="js-next"><svg class="icon--14_14"><use xlink:href="#iconDown"/></svg></div>
                    <div class="js-close"><svg class="icon--14_14"><use xlink:href="#iconClose"/></svg></div>
                </div>
            </div>
        `;

        this.input = this.element.querySelector('.b3-text-field') as HTMLInputElement;
        this.countEl = this.element.querySelector('.search-count') as HTMLSpanElement;

        this.input.addEventListener('input', this.handleInput);
        this.input.addEventListener('keydown', this.handleKeydown);
        this.countEl.addEventListener('mousedown', this.handleMouseDown);
        (this.element.querySelector('.js-last') as HTMLElement).addEventListener('click', this.clickLast);
        (this.element.querySelector('.js-next') as HTMLElement).addEventListener('click', this.clickNext);
        (this.element.querySelector('.js-close') as HTMLElement).addEventListener('click', this.clickClose);

        this.plugin?.onSearchComponentMounted?.(this.eventBusHandle);

        if (opts.presetText) {
            this.searchText = opts.presetText;
            this.input.value = opts.presetText;
            this.input.focus();
            this.highlightHitResult(opts.presetText, true);
        } else {
            this.input.focus();
            this.input.select();
        }
    }

    destroy() {
        this.clearHighlight();
        this.input.removeEventListener('input', this.handleInput);
        this.input.removeEventListener('keydown', this.handleKeydown);
        this.countEl.removeEventListener('mousedown', this.handleMouseDown);
        (this.element.querySelector('.js-last') as HTMLElement)?.removeEventListener('click', this.clickLast);
        (this.element.querySelector('.js-next') as HTMLElement)?.removeEventListener('click', this.clickNext);
        (this.element.querySelector('.js-close') as HTMLElement)?.removeEventListener('click', this.clickClose);
        clearTimeout(this.typingTimer);
        this.plugin?.onSearchComponentUnmounted?.(this.eventBusHandle);
    }

    setSearchText(text: string) {
        this.searchText = text;
        this.input.value = text;
        this.input.focus();
        this.highlightHitResult(text, true);
    }

    focus() {
        this.input.focus();
        this.input.select();
    }

    highlightHitResult(value: string, change: boolean) {
        const ranges = this.calculateSearchResults(value, change);
        if (ranges.length === 0) {
            this.clearHighlight();
            return;
        }
        this.clearHighlight();
        const searchResultsHighlight = new Highlight(...ranges);
        CSS.highlights.set("search-results", searchResultsHighlight);
        this.plugin?.updateLastHighlightComponent?.(this.element);
    }

    private updateCount() {
        this.countEl.textContent = `${this.resultIndex}/${this.resultCount}`;
    }

    private clearHighlight() {
        CSS.highlights.delete("search-results");
        CSS.highlights.delete("search-focus");
    }

    private handleInput = () => {
        this.searchText = this.input.value;
        clearTimeout(this.typingTimer);
        this.typingTimer = window.setTimeout(() => {
            this.highlightHitResult(this.searchText, true);
        }, this.doneTypingInterval);
    }

    private handleKeydown = (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
            if (event.shiftKey) {
                event.preventDefault();
                this.clickLast();
            } else if (!event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                this.clickNext();
            }
        } else if (event.key === 'Escape') {
            if (!event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                this.clickClose();
            }
        }
    }

    private handleMouseDown = (event: MouseEvent) => {
        if (isMobile()) return;
        const searchDialog = (event.currentTarget as HTMLElement).closest('.search-dialog') as HTMLElement;
        this.plugin?.startDragging?.(searchDialog, event.clientX, event.clientY);
        event.preventDefault();
    }

    private eventBusHandle = (event: CustomEvent) => {
        if (["savedoc", "rename"].includes(event.detail.cmd)) {
            clearTimeout(this.typingTimer);
            this.typingTimer = window.setTimeout(() => {
                if (this.plugin?.isLastHighlightComponent?.(this.element)) {
                    this.highlightHitResult(this.searchText, false);
                    if (this.resultIndex >= 1) {
                        this.scroollIntoRanges(this.resultIndex - 1, false);
                    }
                } else {
                    this.calculateSearchResults(this.searchText, false);
                }
            }, this.doneTypingInterval);
        } else if (["loaded-protyle-dynamic", "loaded-protyle-static", "switch-protyle", "switch-protyle-mode"].includes(event.type)) {
            const protyleElement = event.detail?.protyle?.element;
            if (!protyleElement) return;
            const layoutTabContainer = protyleElement.closest(".layout-tab-container");
            if (layoutTabContainer && !layoutTabContainer.contains(this.element)) return;
            const blockPopover = protyleElement.closest(".block__popover");
            if (blockPopover && !blockPopover.contains(this.element)) return;
            clearTimeout(this.typingTimer);
            this.typingTimer = window.setTimeout(() => {
                this.resultIndex = 0;
                this.updateCount();
                if (this.plugin?.isLastHighlightComponent?.(this.element)) {
                    this.highlightHitResult(this.searchText, false);
                } else {
                    this.calculateSearchResults(this.searchText, false);
                }
            }, this.doneTypingInterval);
        }
    }

    private clickLast = () => {
        if ((this.resultIndex > 1 && this.resultIndex <= this.resultCount) && this.resultCount != 0) {
            this.resultIndex = this.resultIndex - 1;
        } else if ((this.resultIndex <= 1 || this.resultIndex > this.resultCount) && this.resultCount != 0) {
            this.resultIndex = this.resultCount;
        } else if (this.resultCount == 0) {
            this.resultIndex = 0;
        }
        this.updateCount();
        this.scroollIntoRanges(this.resultIndex - 1);
    }

    private clickNext = () => {
        if (this.resultIndex < this.resultCount) {
            this.resultIndex = this.resultIndex + 1;
        } else if (this.resultIndex >= this.resultCount && this.resultCount != 0) {
            this.resultIndex = 1;
        } else if (this.resultCount == 0) {
            this.resultIndex = 0;
        }
        this.updateCount();
        this.scroollIntoRanges(this.resultIndex - 1);
    }

    private clickClose = () => {
        this.clearHighlight();
        this.plugin?.closeCurrentSearchDialog?.(this.element);
    }

    /**
     * 生成搜索关键词的变体，解决 Issue #42：同时搜索包含空白字符和不包含空白字符的结果
     */
    private generateSearchVariants(searchStr: string): string[] {
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

    // 计算搜索结果并更新数字，不执行高亮操作
    private calculateSearchResults(value: string, change: boolean): Range[] {
        const str = value.trim().toLowerCase();
        if (!str) {
            // 当搜索文本为空时，清除已有的高亮
            this.clearHighlight();
            return [];
        }

        // 如果文本框内容改变，搜索结果和索引计数都立刻清零
        if (change === true) {
            this.resultIndex = 0;
            this.resultCount = 0;
            this.updateCount();
        }

        // 获取文档根，后续直接对全文档文本进行搜索
        // 选择器1：桌面端正常打开的页签文档（直接子元素查找）
        let docRoot = this.edit.querySelector(':scope > .protyle:not(.fn__none) :is(.protyle-content:not(.fn__none) .protyle-wysiwyg, .protyle-preview:not(.fn__none) .b3-typography)') as HTMLElement;
        // 选择器2：桌面端浮窗和搜索窗口、移动端编辑器（内部查找，不限制为直接子元素）
        if (!docRoot) {
            docRoot = this.edit.querySelector('.protyle:not(.fn__none) :is(.protyle-content:not(.fn__none) .protyle-wysiwyg, .protyle-preview:not(.fn__none) .b3-typography)') as HTMLElement;
        }
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

        const searchVariants = this.generateSearchVariants(str);
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

        // 检查元素是否可见，使用最新的 checkVisibility() API
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

        // 为指定位置创建 Range
        function createRangeForPosition(startIndex: number, endIndex: number, cur_nodeIdx: number, allTextNodes: Text[], incr_lens: number[], processedRanges: Set<string>, ranges: Range[]): boolean {
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

        // 将标准化后的位置转换为原始文档中的位置
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

        this.resultCount = ranges.length;
        this.resultRange = ranges;
        this.updateCount();
        return ranges;
    }

    /**
     * 查找包含指定元素的所有滚动容器（从最内层到最外层）
     * 支持垂直和横向滚动容器
     */
    private findScrollContainers(element: Element): HTMLElement[] {
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
    private scrollContainerToRange(range: Range, container: HTMLElement) {
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

    private scroollIntoRanges(index: number, scroll: boolean = true) {
        const ranges = this.resultRange;
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
                const scrollContainers = this.findScrollContainers(ancestorElement);
                scrollContainers.forEach(container => {
                    this.scrollContainerToRange(range, container);
                });
                if (scrollContainers.length === 0) {
                    const docContentElement = this.edit.querySelector(':scope > .protyle:not(.fn__none) :is(.protyle-content:not(.fn__none), .protyle-preview:not(.fn__none))') as HTMLElement;
                    if (docContentElement) {
                        this.scrollContainerToRange(range, docContentElement);
                    }
                }
            }
        }
        CSS.highlights.set("search-focus", new Highlight(range));
        this.plugin?.updateLastHighlightComponent?.(this.element);
    }
}
