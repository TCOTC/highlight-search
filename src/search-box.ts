import {
    calculateSearchResults,
    clearHighlight,
    highlightHitResult,
    scrollIntoRanges,
} from "./search";
import type { EventBusLike, SearchHost } from "./types";
import { isMobile } from "./utils";

const PLACEHOLDER = "🔍︎ (Shift) + Enter";
const SEARCH_BOX_KEY = Symbol("highlight-search-box");

/** 需要刷新搜索结果的插件事件 */
const EVENT_NAMES = [
    "ws-main",
    // 动态加载之后需要刷新搜索结果并高亮，但不要滚动
    "loaded-protyle-dynamic",
    // 浮窗查看上下文会重新加载编辑器，此时需要刷新搜索结果并高亮，但不要滚动
    "loaded-protyle-static",
    // 切换编辑器模式之后需要刷新搜索结果并高亮，但不要滚动
    // https://github.com/siyuan-note/siyuan/issues/15516
    "switch-protyle-mode",
] as const;

/** 从搜索框根节点取回绑定的实例 */
export function getSearchBox(element: Element): SearchBox | undefined {
    return (element as { [SEARCH_BOX_KEY]?: SearchBox })[SEARCH_BOX_KEY];
}

export class SearchBox {
    private protyleEl: Element;
    private element: Element;
    private plugin: SearchHost;
    private eventBus: EventBusLike;
    private input: HTMLInputElement;
    private countEl: HTMLSpanElement;

    private searchText = "";
    private resultCount = 0;
    private resultIndex = 0;
    private resultRange: Range[] = [];

    private typingTimer: number | undefined;
    private readonly doneTypingInterval = 400;
    private destroyed = false;
    private detachObservers: MutationObserver[] = [];
    private readonly abort = new AbortController();

    constructor(opts: {
        protyleEl: Element;
        element: Element;
        plugin: SearchHost;
        eventBus: EventBusLike;
        presetText: string;
    }) {
        this.protyleEl = opts.protyleEl;
        this.element = opts.element;
        this.plugin = opts.plugin;
        this.eventBus = opts.eventBus;

        this.element.innerHTML = `
            <div class="search-dialog">
                <div class="b3-form__icon search-input">
                    <input type="text" class="b3-text-field fn__size200" spellcheck="false" placeholder="${PLACEHOLDER}" />
                </div>
                <span class="search-count${!isMobile() ? " search-count--draggable" : ""}">0/0</span>
                <div class="search-tools">
                    <div class="js-last"><svg class="icon--14_14"><use xlink:href="#iconUp"/></svg></div>
                    <div class="js-next"><svg class="icon--14_14"><use xlink:href="#iconDown"/></svg></div>
                    <div class="js-close"><svg class="icon--14_14"><use xlink:href="#iconClose"/></svg></div>
                </div>
            </div>
        `;

        this.input = this.element.querySelector(".b3-text-field") as HTMLInputElement;
        this.countEl = this.element.querySelector(".search-count") as HTMLSpanElement;

        const { signal } = this.abort;
        this.input.addEventListener("input", this.handleInput, { signal });
        this.input.addEventListener("keydown", this.handleKeydown, { signal });
        this.countEl.addEventListener("mousedown", this.handleMouseDown, { signal });
        (this.element.querySelector(".js-last") as HTMLElement).addEventListener("click", this.clickLast, { signal });
        (this.element.querySelector(".js-next") as HTMLElement).addEventListener("click", this.clickNext, { signal });
        (this.element.querySelector(".js-close") as HTMLElement).addEventListener("click", this.clickClose, { signal });

        (this.element as { [SEARCH_BOX_KEY]?: SearchBox })[SEARCH_BOX_KEY] = this;
        this.watchDetach();
        this.eventBusOn();
        this.plugin.onSearchComponentMounted();

        if (opts.presetText) {
            this.searchText = opts.presetText;
            this.input.value = opts.presetText;
            this.input.focus();
            this.runHighlight(opts.presetText, true);
        } else {
            this.input.focus();
            this.input.select();
        }
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;

        // 先断开观察，避免主动 remove() 时重复进入
        this.unwatchDetach();
        this.abort.abort();
        this.eventBusOff();
        delete (this.element as { [SEARCH_BOX_KEY]?: SearchBox })[SEARCH_BOX_KEY];

        clearHighlight();
        clearTimeout(this.typingTimer);
        this.plugin.onSearchComponentUnmounted();
    }

    /**
     * 沿祖先链用 childList（不含 subtree）监听节点被摘除。
     * 可覆盖关最后页签拆窗口等场景，且不会被编辑器内部 DOM 变动刷屏。
     */
    private watchDetach() {
        this.unwatchDetach();

        const element = this.element;
        let child: Element = element;
        let parent = element.parentElement;

        while (parent) {
            const observedChild = child;
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.removedNodes) {
                        if (
                            node === observedChild ||
                            (node instanceof Element && node.contains(element))
                        ) {
                            this.destroy();
                            return;
                        }
                    }
                }
            });
            observer.observe(parent, { childList: true });
            this.detachObservers.push(observer);

            if (parent === document.body) {
                break;
            }
            child = parent;
            parent = parent.parentElement;
        }
    }

    private unwatchDetach() {
        this.detachObservers.forEach((observer) => observer.disconnect());
        this.detachObservers = [];
    }

    private eventBusOn() {
        for (const name of EVENT_NAMES) {
            this.eventBus.on(name, this.eventBusHandle);
        }
    }

    private eventBusOff() {
        for (const name of EVENT_NAMES) {
            this.eventBus.off(name, this.eventBusHandle);
        }
    }

    setSearchText(text: string) {
        this.searchText = text;
        this.input.value = text;
        this.input.focus();
        this.runHighlight(text, true);
    }

    focus() {
        this.input.focus();
        this.input.select();
    }

    private updateCount() {
        this.countEl.textContent = `${this.resultIndex}/${this.resultCount}`;
    }

    private applyRanges(ranges: Range[], change: boolean) {
        if (change) {
            this.resultIndex = 0;
        }
        this.resultRange = ranges;
        this.resultCount = ranges.length;
        this.updateCount();
    }

    private runHighlight(value: string, change: boolean) {
        const ranges = highlightHitResult(this.protyleEl, value);
        this.applyRanges(ranges, change);
        if (ranges.length > 0) {
            this.plugin.updateLastHighlightComponent(this.element);
        }
    }

    private runCalculate(value: string, change: boolean) {
        const ranges = calculateSearchResults(this.protyleEl, value);
        this.applyRanges(ranges, change);
        if (!value.trim()) {
            clearHighlight();
        }
    }

    private handleInput = () => {
        this.searchText = this.input.value;
        clearTimeout(this.typingTimer);
        this.typingTimer = window.setTimeout(() => {
            this.runHighlight(this.searchText, true);
        }, this.doneTypingInterval);
    };

    private handleKeydown = (event: KeyboardEvent) => {
        if (event.key === "Enter") {
            if (event.shiftKey) {
                event.preventDefault();
                this.clickLast();
            } else if (!event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                this.clickNext();
            }
        } else if (event.key === "Escape") {
            if (!event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                this.clickClose();
            }
        }
    };

    private handleMouseDown = (event: MouseEvent) => {
        if (isMobile()) return;
        const searchDialog = (event.currentTarget as HTMLElement).closest(".search-dialog") as HTMLElement;
        this.plugin.startDragging(searchDialog, event.clientX, event.clientY);
        event.preventDefault();
    };

    private eventBusHandle = (event: CustomEvent) => {
        if (["savedoc", "rename"].includes(event.detail.cmd)) {
            // ws-main
            clearTimeout(this.typingTimer);
            this.typingTimer = window.setTimeout(() => {
                if (this.plugin.isLastHighlightComponent(this.element)) {
                    this.runHighlight(this.searchText, false);
                    if (this.resultIndex >= 1) {
                        this.scrollToResult(this.resultIndex - 1, false);
                    }
                } else {
                    this.runCalculate(this.searchText, false);
                }
            }, this.doneTypingInterval);
        } else if (["loaded-protyle-dynamic", "loaded-protyle-static", "switch-protyle-mode"].includes(event.type)) {
            const protyleElement = event.detail?.protyle?.element;
            // 桌面端搜索框在 protyle 内；移动端挂在 #editor 外，不做 contains 判断
            if (!protyleElement || (!isMobile() && !protyleElement.contains(this.element))) return;
            clearTimeout(this.typingTimer);
            this.typingTimer = window.setTimeout(() => {
                this.resultIndex = 0;
                this.updateCount();
                if (this.plugin.isLastHighlightComponent(this.element)) {
                    this.runHighlight(this.searchText, false);
                } else {
                    this.runCalculate(this.searchText, false);
                }
            }, this.doneTypingInterval);
        }
    };

    private clickLast = () => {
        if (this.resultCount === 0) {
            this.resultIndex = 0;
        } else if (this.resultIndex > 1 && this.resultIndex <= this.resultCount) {
            this.resultIndex -= 1;
        } else {
            this.resultIndex = this.resultCount;
        }
        this.updateCount();
        this.scrollToResult(this.resultIndex - 1);
    };

    private clickNext = () => {
        if (this.resultCount === 0) {
            this.resultIndex = 0;
        } else if (this.resultIndex < this.resultCount) {
            this.resultIndex += 1;
        } else {
            this.resultIndex = 1;
        }
        this.updateCount();
        this.scrollToResult(this.resultIndex - 1);
    };

    private clickClose = () => {
        this.plugin.closeCurrentSearchDialog(this.element);
    };

    private scrollToResult(index: number, scroll: boolean = true) {
        scrollIntoRanges(this.protyleEl, this.resultRange, index, scroll);
        this.plugin.updateLastHighlightComponent(this.element);
    }
}
