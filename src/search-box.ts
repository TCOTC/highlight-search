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
    /** 当前编辑器对应文档 ID（protyle.block.rootID） */
    private docId: string;

    private searchText = "";
    private resultCount = 0;
    private resultIndex = 0;
    private resultRange: Range[] = [];

    /** 已提交的搜索词，变化时写入历史 */
    private committedText = "";
    /** 历史浏览光标；-1 表示当前输入（未在浏览） */
    private historyCursor = -1;
    /** 开始浏览历史前的草稿文本 */
    private historyDraft = "";
    /** 本次浏览快照（当前文档，旧 → 新），避免浏览中列表变动导致错位 */
    private historyView: string[] = [];
    /** 本实例会话内：关键词 → 结果索引（不持久化） */
    private resultIndexByText = new Map<string, number>();

    private typingTimer: number | undefined;
    private readonly doneTypingInterval = 400;
    private destroyed = false;
    private detachObservers: MutationObserver[] = [];
    private readonly abort = new AbortController();

    /** 按住计数区拖拽移动搜索框 */
    private dragging = false;
    private dragStartX = 0;
    private dragStartY = 0;
    private dragInitialLeft = 0;
    private dragInitialTop = 0;

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
        /** 当前文档 ID，用于按文档隔离历史 */
        docId: string;
        placeholder: string;
    }) {
        this.protyleEl = opts.protyleEl;
        this.element = opts.element;
        this.plugin = opts.plugin;
        this.eventBus = opts.eventBus;
        this.docId = opts.docId;

        const { placeholder } = opts;
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
        this.countEl.addEventListener("mousedown", this.handleDragMouseDown, { signal });
        (this.element.querySelector(".js-last") as HTMLElement).addEventListener("click", this.clickLast, { signal });
        (this.element.querySelector(".js-next") as HTMLElement).addEventListener("click", this.clickNext, { signal });
        (this.element.querySelector(".js-close") as HTMLElement).addEventListener("click", this.clickClose, { signal });

        if (!isMobile()) {
            const sash = this.element.querySelector(".search-sash") as HTMLElement | null;
            if (sash) {
                sash.addEventListener("mousedown", this.handleSashMouseDown, { signal });
                // 双击 sash 恢复默认宽度，对齐 VS Code
                sash.addEventListener("dblclick", this.handleSashDblClick, { signal });
            }
            // 位置拖拽与调宽共用 document 级指针事件
            document.addEventListener("mousemove", this.handlePointerMouseMove, { signal });
            document.addEventListener("mouseup", this.handlePointerMouseUp, { signal });
        }

        (this.element as { [SEARCH_BOX_KEY]?: SearchBox })[SEARCH_BOX_KEY] = this;
        this.watchDetach();
        this.watchHostSize();
        this.eventBusOn();

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
        this.endPointerInteraction();
        this.abort.abort();
        this.eventBusOff();
        delete (this.element as { [SEARCH_BOX_KEY]?: SearchBox })[SEARCH_BOX_KEY];

        setHasSearchKeyword(this, false);
        clearHighlight(this);
        clearTimeout(this.typingTimer);
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
        this.historyCursor = -1;
        this.historyView = [];
        this.searchText = text;
        this.input.value = text;
        this.input.focus();
        this.runHighlight(text, true);
    }

    /** 切换文档时更新 ID，并退出历史浏览 */
    setDocId(docId: string) {
        if (!docId || docId === this.docId) return;
        this.docId = docId;
        this.historyCursor = -1;
        this.historyView = [];
        this.resultIndexByText.clear();
    }

    focus() {
        this.input.focus();
        this.input.select();
    }

    /** 清除拖拽产生的定位样式，回到默认右上角 */
    resetPosition() {
        this.dialogEl.style.position = "";
        this.dialogEl.style.left = "";
        this.dialogEl.style.top = "";
        this.dialogEl.style.zIndex = "";
        this.syncInputWidthToHost();
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

    private runHighlight(value: string, change: boolean, fromHistory = false) {
        // 关键词提交变化时写入「文档 ID + 关键词」历史并持久化
        // https://github.com/TCOTC/highlight-search/issues/16
        if (change && !fromHistory && this.committedText && this.committedText !== value) {
            this.rememberResultIndex(this.committedText, this.resultIndex);
        }
        if (change && !fromHistory && value && value !== this.committedText) {
            this.plugin.pushSearchHistory(this.docId, value);
        }
        setHasSearchKeyword(this, value.length > 0);
        const ranges = highlightHitResult(this, this.protyleEl, value);
        this.applyRanges(ranges, change);
        if (change) {
            this.committedText = value;
        }
    }

    /** 本实例内记住关键词对应的结果索引 */
    private rememberResultIndex(text: string, index: number) {
        if (!text) return;
        this.resultIndexByText.set(text, Math.max(0, index));
    }

    /** 用历史关键词（或草稿）恢复输入、高亮，并尽量还原本实例记住的结果索引 */
    private restoreHistoryText(text: string, fromHistory: boolean) {
        this.searchText = text;
        this.input.value = text;
        this.runHighlight(text, true, fromHistory);
        if (fromHistory) {
            const savedIndex = this.resultIndexByText.get(text) ?? 0;
            if (this.resultCount > 0 && savedIndex >= 1) {
                this.resultIndex = Math.min(savedIndex, this.resultCount);
                this.updateCount();
                this.scrollToResult(this.resultIndex - 1);
            }
        }
        this.input.select();
    }

    /**
     * 方向键切换当前文档的搜索历史。
     * ↑ 更早，↓ 更新；越过最新一条时回到开始浏览前的草稿。
     */
    private navigateHistory(direction: -1 | 1) {
        if (this.historyCursor === -1) {
            if (direction === 1) return;
            this.historyView = this.plugin.getSearchHistory(this.docId);
            if (this.historyView.length === 0) return;
            this.historyDraft = this.input.value;
            this.rememberResultIndex(this.historyDraft, this.resultIndex);
            this.historyCursor = this.historyView.length - 1;
            // 最新一条常为当前已提交关键词，再往前一条才是「上一次」
            if (this.historyView[this.historyCursor] === this.historyDraft) {
                if (this.historyCursor === 0) return;
                this.historyCursor -= 1;
            }
        } else {
            this.rememberResultIndex(this.historyView[this.historyCursor], this.resultIndex);
            const next = this.historyCursor + direction;
            if (next < 0) return;
            if (next >= this.historyView.length) {
                this.historyCursor = -1;
                this.historyView = [];
                this.restoreHistoryText(this.historyDraft, true);
                return;
            }
            this.historyCursor = next;
        }

        this.restoreHistoryText(this.historyView[this.historyCursor], true);
    }

    private handleInput = () => {
        if (this.historyCursor >= 0) {
            this.rememberResultIndex(this.historyView[this.historyCursor], this.resultIndex);
        } else if (this.committedText) {
            this.rememberResultIndex(this.committedText, this.resultIndex);
        }
        this.searchText = this.input.value;
        // 手动输入则退出历史浏览
        this.historyCursor = -1;
        this.historyView = [];
        clearTimeout(this.typingTimer);
        this.typingTimer = window.setTimeout(() => {
            this.runHighlight(this.searchText, true);
        }, this.doneTypingInterval);
    };

    private handleKeydown = (event: KeyboardEvent) => {
        if (event.key === "ArrowUp") {
            if (!event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                this.navigateHistory(-1);
            }
        } else if (event.key === "ArrowDown") {
            if (!event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                this.navigateHistory(1);
            }
        } else if (event.key === "Enter") {
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

    private handleDragMouseDown = (event: MouseEvent) => {
        if (isMobile() || event.button !== 0) return;
        event.preventDefault();

        this.dragging = true;
        this.dragStartX = event.clientX;
        this.dragStartY = event.clientY;
        const rect = this.dialogEl.getBoundingClientRect();
        this.dragInitialLeft = rect.left;
        this.dragInitialTop = rect.top;
        document.body.classList.add("jchs-dragging");
    };

    private handlePointerMouseMove = (event: MouseEvent) => {
        if (this.dragging) {
            const deltaX = event.clientX - this.dragStartX;
            const deltaY = event.clientY - this.dragStartY;
            this.dialogEl.style.position = "fixed";
            this.dialogEl.style.left = `${this.dragInitialLeft + deltaX}px`;
            this.dialogEl.style.top = `${this.dragInitialTop + deltaY}px`;
            this.dialogEl.style.zIndex = "9999";
            return;
        }
        this.handleSashMouseMove(event);
    };

    private handlePointerMouseUp = () => {
        this.endPointerInteraction();
    };

    private endPointerInteraction() {
        if (this.dragging) {
            this.dragging = false;
            document.body.classList.remove("jchs-dragging");
        }
        this.handleSashMouseUp();
    }

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
            const protyle = event.detail?.protyle;
            const protyleElement = protyle?.element;
            // 桌面端搜索框在 protyle 内；移动端挂在 #editor 外，不做 contains 判断
            if (!protyleElement || (!isMobile() && !protyleElement.contains(this.element))) return;
            const rootID = protyle?.block?.rootID;
            if (typeof rootID === "string" && rootID) {
                this.setDocId(rootID);
            }
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
        this.rememberResultIndex(this.searchText, this.resultIndex);
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
        this.rememberResultIndex(this.searchText, this.resultIndex);
    };

    private clickClose = () => {
        this.plugin.closeCurrentSearchDialog(this.element);
    };

    private scrollToResult(index: number, scroll: boolean = true) {
        scrollIntoRanges(this, this.protyleEl, this.resultRange, index, scroll);
    }
}
