import { applyFocusHighlight } from "./css-highlight";

/** 可滚动的内容容器 */
function getDocContent(protyleEl: Element): HTMLElement | null {
    return protyleEl.querySelector(":is(.protyle-content:not(.fn__none), .protyle-preview:not(.fn__none))");
}

export function findScrollContainers(element: Element): HTMLElement[] {
    const containers: HTMLElement[] = [];
    let current: Element | null = element;
    while (current && current !== document.body) {
        const htmlElement = current as HTMLElement;
        const overflowY = window.getComputedStyle(htmlElement).overflowY;
        const overflowX = window.getComputedStyle(htmlElement).overflowX;
        const canScrollY =
            (overflowY === "auto" || overflowY === "scroll") &&
            htmlElement.scrollHeight > htmlElement.clientHeight;
        const canScrollX =
            (overflowX === "auto" || overflowX === "scroll") &&
            htmlElement.scrollWidth > htmlElement.clientWidth;
        if (canScrollY || canScrollX) {
            containers.push(htmlElement);
        }
        current = current.parentElement;
    }
    return containers;
}

export function scrollContainerToRange(range: Range, container: HTMLElement) {
    const rangeRect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const containerStyle = window.getComputedStyle(container);
    const rangeCenterX = (rangeRect.left + rangeRect.right) / 2;
    const overflowY = containerStyle.overflowY;
    const overflowX = containerStyle.overflowX;
    const canScrollY =
        (overflowY === "auto" || overflowY === "scroll") &&
        container.scrollHeight > container.clientHeight;
    const canScrollX =
        (overflowX === "auto" || overflowX === "scroll") &&
        container.scrollWidth > container.clientWidth;
    if (canScrollY) {
        const rangeCenterY = (rangeRect.top + rangeRect.bottom) / 2;
        const rangeCenterYInContent = rangeCenterY - containerRect.top + container.scrollTop;
        const targetScrollTop = rangeCenterYInContent - container.clientHeight / 2;
        const maxScrollTop = container.scrollHeight - container.clientHeight;
        container.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
    }
    if (canScrollX) {
        const rangeCenterXInContent = rangeCenterX - containerRect.left + container.scrollLeft;
        const targetScrollLeft = rangeCenterXInContent - container.clientWidth / 2;
        const maxScrollLeft = container.scrollWidth - container.clientWidth;
        container.scrollLeft = Math.max(0, Math.min(targetScrollLeft, maxScrollLeft));
    }
}

export function scrollToRange(
    source: object,
    protyleEl: Element,
    range: Range,
    scroll: boolean = true,
) {
    if (scroll) {
        const commonAncestor = range.commonAncestorContainer;
        const ancestorElement =
            commonAncestor.nodeType === Node.TEXT_NODE
                ? commonAncestor.parentElement
                : (commonAncestor as Element);
        if (ancestorElement) {
            const scrollContainers = findScrollContainers(ancestorElement);
            scrollContainers.forEach((container) => {
                scrollContainerToRange(range, container);
            });
            if (scrollContainers.length === 0) {
                const docContentElement = getDocContent(protyleEl);
                if (docContentElement) {
                    scrollContainerToRange(range, docContentElement);
                }
            }
        }
    }
    applyFocusHighlight(source, range);
}
