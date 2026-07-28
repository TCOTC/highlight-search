import {
    clearHighlight,
    highlightHitResult,
    scrollIntoRanges,
    setHasSearchKeyword,
} from "./search";
import type { EventBusLike, SearchHost } from "./types";
import { isMobile } from "./utils";

const SEARCH_BOX_KEY = Symbol("highlight-search-box");

/** 输入框默认 / 最小宽度，对齐 VS Code find-widget 可拖拽左侧 sash 的交互 */
const DEFAULT_INPUT_WIDTH = 188;
const MIN_INPUT_WIDTH = 80;

/** 读取思源内置语言包文案，缺失时回退到 fallback */
function syLang(key: string, fallback: string): string {
    return (window as any).siyuan?.languages?.[key] || fallback;
}

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
    private dialogEl: HTMLElement;

    private searchText = "";
    private resultCount = 0;
    private resultIndex = 0;
    private resultRange: Range[] = [];

    private typingTimer: number | undefined;
    private readonly doneTypingInterval = 400;
    private destroyed = false;
    private detachObservers: MutationObserver[] = [];
    private readonly abort = new AbortController();

    /** 左侧 sash 调整输入框宽度 */
    private resizing = false;
    private resizeStartX = 0;
    private resizeStartInputWidth = DEFAULT_INPUT_WIDTH;
    private resizeStartDialogLeft = 0;
    private resizeHasFixedLeft = false;
    /** 用户期望的输入框宽度；宿主变窄时仅钳制显示，变宽后按此恢复 */
    private preferredInputWidth = DEFAULT_INPUT_WIDTH;
    private hostResizeObserver: ResizeObserver | null = null;

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

        const placeholder = syLang("search", "Search");
        const labelPrev = syLang("previous", "Previous");
        const labelNext = syLang("next", "Next");
        const labelClose = syLang("close", "Close");
        const dragClass = !isMobile() ? " search-count--draggable" : "";

        // 布局对齐 VS Code 编辑器内 find-widget：左侧 sash + 输入框 + 计数 + 上一项/下一项/关闭
        this.element.innerHTML = `
            <div class="search-dialog">
                ${!isMobile() ? '<div class="search-sash"></div>' : ""}
                <input type="text" class="b3-text-field search-input" spellcheck="false" placeholder="${placeholder}" />
                <div class="search-actions">
                    <span class="search-count${dragClass}">0/0</span>
                    <span class="block__icon block__icon--show ariaLabel js-last" data-position="north" aria-label="${labelPrev}">
                        <svg><use xlink:href="#iconUp"/></svg>
                    </span>
                    <span class="block__icon block__icon--show ariaLabel js-next" data-position="north" aria-label="${labelNext}">
                        <svg><use xlink:href="#iconDown"/></svg>
                    </span>
                    <span class="block__icon block__icon--show ariaLabel js-close" data-position="north" aria-label="${labelClose}">
                        <svg><use xlink:href="#iconClose"/></svg>
                    </span>
                </div>
            </div>
        `;

        this.dialogEl = this.element.querySelector(".search-dialog") as HTMLElement;
        this.input = this.element.querySelector(".search-input") as HTMLInputElement;
        this.countEl = this.element.querySelector(".search-count") as HTMLSpanElement;

        const { signal } = this.abort;
        this.input.addEventListener("input", this.handleInput, { signal });
        this.input.addEventListener("keydown", this.handleKeydown, { signal });
        this.countEl.addEventListener("mousedown", this.handleMouseDown, { signal });
        (this.element.querySelector(".js-last") as HTMLElement).addEventListener("click", this.clickLast, { signal });
        (this.element.querySelector(".js-next") as HTMLElement).addEventListener("click", this.clickNext, { signal });
        (this.element.querySelector(".js-close") as HTMLElement).addEventListener("click", this.clickClose, { signal });

        const sash = this.element.querySelector(".search-sash") as HTMLElement | null;
        if (sash) {
            sash.addEventListener("mousedown", this.handleSashMouseDown, { signal });
            // 双击 sash 恢复默认宽度，对齐 VS Code
            sash.addEventListener("dblclick", this.handleSashDblClick, { signal });
            document.addEventListener("mousemove", this.handleSashMouseMove, { signal });
            document.addEventListener("mouseup", this.handleSashMouseUp, { signal });
        }

        (this.element as { [SEARCH_BOX_KEY]?: SearchBox })[SEARCH_BOX_KEY] = this;
        this.watchDetach();
        this.watchHostSize();
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
        this.unwatchHostSize();
        this.handleSashMouseUp();
        this.abort.abort();
        this.eventBusOff();
        delete (this.element as { [SEARCH_BOX_KEY]?: SearchBox })[SEARCH_BOX_KEY];

        setHasSearchKeyword(this, false);
        clearHighlight(this);
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
        // 有搜索词但无结果时用错误色，对齐 VS Code find-widget 的 no-results
        this.countEl.classList.toggle(
            "search-count--empty",
            this.searchText.length > 0 && this.resultCount === 0,
        );
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
        setHasSearchKeyword(this, value.length > 0);
        const ranges = highlightHitResult(this, this.protyleEl, value);
        this.applyRanges(ranges, change);
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
        this.plugin.startDragging(this.dialogEl, event.clientX, event.clientY);
        event.preventDefault();
    };

    private getInputWidth(): number {
        return this.input.getBoundingClientRect().width || DEFAULT_INPUT_WIDTH;
    }

    private getHostEl(): HTMLElement {
        return (this.element.parentElement ?? this.protyleEl) as HTMLElement;
    }

    /** 输入框最大宽度：宿主 / 视口宽度减去操作区与边距 */
    private getMaxInputWidth(): number {
        const actions = this.element.querySelector(".search-actions") as HTMLElement | null;
        const actionsWidth = actions?.getBoundingClientRect().width ?? 120;
        const chrome = 24; // dialog padding + border + 余量
        const hostWidth = this.dialogEl.style.position === "fixed"
            ? window.innerWidth
            : this.getHostEl().clientWidth;
        return Math.max(MIN_INPUT_WIDTH, hostWidth - actionsWidth - chrome);
    }

    /** 按目标宽度写入样式（钳制到宿主可用范围），不修改 preferred */
    private applyInputWidth(width: number) {
        const next = Math.min(Math.max(width, MIN_INPUT_WIDTH), this.getMaxInputWidth());
        if (this.preferredInputWidth === DEFAULT_INPUT_WIDTH && next === DEFAULT_INPUT_WIDTH) {
            this.input.style.width = "";
        } else {
            this.input.style.width = `${next}px`;
        }
        return next;
    }

    /** 宿主或视口尺寸变化时，按 preferred 重新钳制，避免搜索框溢出 */
    private syncInputWidthToHost = () => {
        if (this.destroyed || this.resizing) return;
        this.applyInputWidth(this.preferredInputWidth);
    };

    private watchHostSize() {
        this.unwatchHostSize();
        const host = this.getHostEl();
        this.hostResizeObserver = new ResizeObserver(() => {
            this.syncInputWidthToHost();
        });
        this.hostResizeObserver.observe(host);
        window.addEventListener("resize", this.syncInputWidthToHost, { signal: this.abort.signal });
        this.syncInputWidthToHost();
    }

    private unwatchHostSize() {
        this.hostResizeObserver?.disconnect();
        this.hostResizeObserver = null;
    }

    private handleSashMouseDown = (event: MouseEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        this.resizing = true;
        this.resizeStartX = event.clientX;
        this.resizeStartInputWidth = this.getInputWidth();
        // 拖拽定位后为 fixed + left；右锚定时无 left，加宽自然向左扩展
        this.resizeHasFixedLeft = this.dialogEl.style.position === "fixed" && !!this.dialogEl.style.left;
        this.resizeStartDialogLeft = this.resizeHasFixedLeft
            ? this.dialogEl.getBoundingClientRect().left
            : 0;
        this.dialogEl.classList.add("search-dialog--resizing");
        document.body.classList.add("jchs-resizing");
    };

    private handleSashMouseMove = (event: MouseEvent) => {
        if (!this.resizing) return;

        // 向左拖加宽：width = start + (startX - currentX)，与 VS Code sash 一致
        const nextWidth = this.applyInputWidth(
            this.resizeStartInputWidth + this.resizeStartX - event.clientX,
        );
        this.preferredInputWidth = nextWidth;
        if (this.resizeHasFixedLeft) {
            const widthDelta = nextWidth - this.resizeStartInputWidth;
            this.dialogEl.style.left = `${this.resizeStartDialogLeft - widthDelta}px`;
        }
    };

    private handleSashMouseUp = () => {
        if (!this.resizing) return;
        this.resizing = false;
        this.dialogEl.classList.remove("search-dialog--resizing");
        document.body.classList.remove("jchs-resizing");
        // 松手后再同步一次，避免拖拽期间宿主尺寸已变
        this.syncInputWidthToHost();
    };

    private handleSashDblClick = (event: MouseEvent) => {
        event.preventDefault();
        const prevWidth = this.getInputWidth();
        this.preferredInputWidth = DEFAULT_INPUT_WIDTH;
        const nextWidth = this.applyInputWidth(DEFAULT_INPUT_WIDTH);
        if (this.dialogEl.style.position === "fixed" && this.dialogEl.style.left) {
            const left = this.dialogEl.getBoundingClientRect().left;
            this.dialogEl.style.left = `${left - (nextWidth - prevWidth)}px`;
        }
    };

    private eventBusHandle = (event: CustomEvent) => {
        if (["savedoc", "rename"].includes(event.detail.cmd)) {
            // ws-main
            clearTimeout(this.typingTimer);
            this.typingTimer = window.setTimeout(() => {
                this.runHighlight(this.searchText, false);
                if (this.resultIndex >= 1) {
                    this.scrollToResult(this.resultIndex - 1, false);
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
                this.runHighlight(this.searchText, false);
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
        scrollIntoRanges(this, this.protyleEl, this.resultRange, index, scroll);
    }
}
