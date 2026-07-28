import { isDebugEnabled } from "./case-settings";
import { FindSession, type FindSessionContext } from "./find-session";
import { getSiYuanCaseSensitive } from "./match-text";
import {
    clearHighlight,
    setHasSearchKeyword,
} from "./search";
import type { EventBusLike, SearchHost } from "./types";
import { isMobile } from "./utils";

const SEARCH_BOX_KEY = Symbol("highlight-search-box");

/** 输入框默认 / 最小宽度，对齐 VS Code find-widget 可拖拽左侧 sash 的交互 */
const DEFAULT_INPUT_WIDTH = 188;
const MIN_INPUT_WIDTH = 80;

/** 结果面板虚拟列表：固定行高（padding 4+4 + line-height 18） */
const PANEL_ITEM_HEIGHT = 26;
/** 列表上下内边距，与 `.search-panel__list` 一致 */
const PANEL_LIST_PADDING = 4;
/** 可视区上下多渲染的行数 */
const PANEL_OVERSCAN = 5;

/** 需要刷新搜索结果的插件事件 */
const EVENT_NAMES = [
    "ws-main",
    // 动态加载之后需要刷新 DOM 高亮，但不要重置 index / 不要滚动
    "loaded-protyle-dynamic",
    // 浮窗查看上下文会重新加载编辑器
    "loaded-protyle-static",
    // 切换编辑器模式之后需要刷新
    // https://github.com/siyuan-note/siyuan/issues/15516
    "switch-protyle-mode",
] as const;

/** 从搜索框根节点取回绑定的实例 */
export function getSearchBox(element: Element): SearchBox | undefined {
    return (element as { [SEARCH_BOX_KEY]?: SearchBox })[SEARCH_BOX_KEY];
}

export class SearchBox {
    private protyleEl: Element;
    private element: HTMLElement;
    private plugin: SearchHost;
    private eventBus: EventBusLike;
    private input: HTMLInputElement;
    private inputBoxEl: HTMLElement;
    private caseToggleEl: HTMLElement;
    private countEl: HTMLSpanElement;
    private dialogEl: HTMLElement;
    private panelEl: HTMLElement;
    private panelListEl: HTMLElement;
    private panelToggleEl: HTMLElement;
    /** 当前编辑器对应文档 ID（protyle.block.rootID） */
    private docId: string;
    private notebookId: string;
    private docPath: string;

    private searchText = "";
    /** 本实例是否区分大小写；默认取思源设置，之后可独立切换 */
    private caseSensitive = false;
    /** 最近一次 runSearch 端到端耗时（毫秒）：建列表 + 高亮 + 定位 */
    private lastSearchMs = 0;
    private readonly session = new FindSession();
    private panelOpen = false;
    /** 程序化改 scrollTop 时跳过 scroll 回调，避免重复渲染 */
    private panelScrollLock = false;
    private panelScrollRaf: number | undefined;

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
    private searchSeq = 0;
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
        element: HTMLElement;
        plugin: SearchHost;
        eventBus: EventBusLike;
        presetText: string;
        docId: string;
        notebookId: string;
        path: string;
        placeholder: string;
    }) {
        this.protyleEl = opts.protyleEl;
        this.element = opts.element;
        this.plugin = opts.plugin;
        this.eventBus = opts.eventBus;
        this.docId = opts.docId;
        this.notebookId = opts.notebookId;
        this.docPath = opts.path;

        const { placeholder } = opts;
        const labelPrev = this.plugin.i18n.previous;
        const labelNext = this.plugin.i18n.next;
        const labelClose = this.plugin.i18n.close;
        const labelCase = this.plugin.i18n.caseSensitiveToggle;
        const labelPanel = this.plugin.i18n.resultsPanelToggle;
        const dragClass = !isMobile() ? " search-count--draggable" : "";

        // 默认跟随思源「设置 → 搜索」的区分大小写
        this.caseSensitive = getSiYuanCaseSensitive();
        const caseOnClass = this.caseSensitive ? " search-case--on" : "";

        this.element.innerHTML = `
            <div class="search-dialog">
                ${!isMobile() ? '<div class="search-sash"></div>' : ""}
                <div class="search-input-box">
                    <input type="text" class="b3-text-field search-input" spellcheck="false" placeholder="${placeholder}" />
                    <span class="ariaLabel search-case js-case${caseOnClass}" data-position="north" aria-label="${labelCase}" aria-pressed="${this.caseSensitive}" role="button" tabindex="-1">Aa</span>
                </div>
                <div class="search-actions">
                    <span class="search-count${dragClass}">0/0</span>
                    <span class="block__icon block__icon--show ariaLabel js-panel" data-position="north" aria-label="${labelPanel}">
                        <svg><use xlink:href="#iconList"/></svg>
                    </span>
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
            <div class="search-panel fn__none">
                <div class="search-panel__list"></div>
            </div>
        `;

        this.dialogEl = this.element.querySelector(".search-dialog") as HTMLElement;
        this.inputBoxEl = this.element.querySelector(".search-input-box") as HTMLElement;
        this.input = this.element.querySelector(".search-input") as HTMLInputElement;
        this.caseToggleEl = this.element.querySelector(".js-case") as HTMLElement;
        this.countEl = this.element.querySelector(".search-count") as HTMLSpanElement;
        this.panelEl = this.element.querySelector(".search-panel") as HTMLElement;
        this.panelListEl = this.element.querySelector(".search-panel__list") as HTMLElement;
        this.panelToggleEl = this.element.querySelector(".js-panel") as HTMLElement;

        const { signal } = this.abort;
        this.input.addEventListener("input", this.handleInput, { signal });
        this.input.addEventListener("keydown", this.handleKeydown, { signal });
        this.caseToggleEl.addEventListener("click", this.toggleCaseSensitive, { signal });
        this.panelToggleEl.addEventListener("click", this.togglePanel, { signal });
        this.panelListEl.addEventListener("click", this.handlePanelClick, { signal });
        this.panelListEl.addEventListener("scroll", this.handlePanelScroll, { signal, passive: true });
        (this.element.querySelector(".js-last") as HTMLElement).addEventListener("click", this.goPrevious, { signal });
        (this.element.querySelector(".js-next") as HTMLElement).addEventListener("click", this.goNext, { signal });
        (this.element.querySelector(".js-close") as HTMLElement).addEventListener("click", this.clickClose, { signal });

        if (!isMobile()) {
            this.countEl.addEventListener("mousedown", this.handleDragMouseDown, { signal });
            this.countEl.addEventListener("dblclick", this.handleDragDblClick, { signal });
            const sash = this.element.querySelector(".search-sash") as HTMLElement | null;
            if (sash) {
                sash.addEventListener("mousedown", this.handleSashMouseDown, { signal });
                sash.addEventListener("dblclick", this.handleSashDblClick, { signal });
            }
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
            void this.runSearch(opts.presetText, true);
        } else {
            this.input.focus();
            this.input.select();
        }
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;

        this.unwatchDetach();
        this.unwatchHostSize();
        this.endPointerInteraction();
        this.abort.abort();
        this.eventBusOff();
        delete (this.element as { [SEARCH_BOX_KEY]?: SearchBox })[SEARCH_BOX_KEY];

        if (this.panelScrollRaf !== undefined) {
            cancelAnimationFrame(this.panelScrollRaf);
            this.panelScrollRaf = undefined;
        }

        setHasSearchKeyword(this, false);
        this.session.clear(this);
        clearHighlight(this);
        clearTimeout(this.typingTimer);
    }

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

    private sessionCtx(): FindSessionContext {
        return {
            app: this.plugin.getApp(),
            protyleEl: this.protyleEl,
            rootId: this.docId,
            notebookId: this.notebookId,
            caseSensitive: this.caseSensitive,
            source: this,
        };
    }

    private syncCaseToggle() {
        this.caseToggleEl.classList.toggle("search-case--on", this.caseSensitive);
        this.caseToggleEl.setAttribute("aria-pressed", String(this.caseSensitive));
    }

    private toggleCaseSensitive = () => {
        this.caseSensitive = !this.caseSensitive;
        this.syncCaseToggle();
        if (this.searchText) {
            void this.runSearch(this.searchText, true);
        }
    };

    setSearchText(text: string) {
        this.historyCursor = -1;
        this.historyView = [];
        this.searchText = text;
        this.input.value = text;
        this.input.focus();
        void this.runSearch(text, true);
    }

    /** 切换文档时更新上下文，并退出历史浏览 */
    setDocContext(opts: { docId: string; notebookId: string; path: string }) {
        const changed =
            opts.docId !== this.docId ||
            opts.notebookId !== this.notebookId ||
            opts.path !== this.docPath;
        if (!opts.docId) return;
        this.docId = opts.docId;
        this.notebookId = opts.notebookId;
        this.docPath = opts.path;
        if (changed) {
            this.historyCursor = -1;
            this.historyView = [];
            this.resultIndexByText.clear();
            if (this.searchText) {
                void this.runSearch(this.searchText, true);
            }
        }
    }

    /** @deprecated 使用 setDocContext */
    setDocId(docId: string) {
        if (!docId || docId === this.docId) return;
        this.setDocContext({
            docId,
            notebookId: this.notebookId,
            path: this.docPath,
        });
    }

    focus() {
        this.input.focus();
        this.input.select();
    }

    /** 清除拖拽产生的定位样式，回到默认右上角 */
    resetPosition() {
        this.element.style.position = "";
        this.element.style.left = "";
        this.element.style.top = "";
        this.element.style.right = "";
        this.element.style.zIndex = "";
        this.syncInputWidthToHost();
    }

    private updateCount() {
        const debug = isDebugEnabled();
        const ms = debug ? this.lastSearchMs : 0;
        const msSuffix = this.searchText && ms > 0 ? ` · ${ms}ms` : "";
        this.countEl.textContent = `${this.session.index}/${this.session.count}${msSuffix}`;
        this.countEl.title = ms > 0 ? `${ms}ms` : "";
        this.countEl.classList.toggle(
            "search-count--empty",
            this.searchText.length > 0 && this.session.count === 0,
        );
    }

    private escapeSnippet(text: string): string {
        return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    private renderPanelItemHtml(i: number): string {
        const match = this.session.matches[i];
        const active = i + 1 === this.session.index ? " search-panel__item--active" : "";
        const snippet = this.escapeSnippet(match.snippet || match.blockId);
        return `<div class="search-panel__item${active}" data-index="${i}" title="${snippet}">${snippet}</div>`;
    }

    /** 结果总数变化后钳制 scrollTop，避免停在无效位置 */
    private clampPanelScroll() {
        const listEl = this.panelListEl;
        const maxScroll = Math.max(
            0,
            PANEL_LIST_PADDING * 2 + this.session.count * PANEL_ITEM_HEIGHT - listEl.clientHeight,
        );
        if (listEl.scrollTop > maxScroll) {
            this.panelScrollLock = true;
            listEl.scrollTop = maxScroll;
            this.panelScrollLock = false;
        }
    }

    /** 将当前激活项滚入可视区（等价于原 scrollIntoView nearest） */
    private scrollActiveIntoView() {
        if (this.session.count === 0) return;
        const listEl = this.panelListEl;
        const activeIndex = this.session.index - 1;
        const itemTop = PANEL_LIST_PADDING + activeIndex * PANEL_ITEM_HEIGHT;
        const itemBottom = itemTop + PANEL_ITEM_HEIGHT;
        const viewTop = listEl.scrollTop;
        const viewBottom = viewTop + listEl.clientHeight;

        let nextScrollTop = viewTop;
        if (itemTop < viewTop) {
            nextScrollTop = itemTop;
        } else if (itemBottom > viewBottom) {
            nextScrollTop = itemBottom - listEl.clientHeight;
        } else {
            return;
        }

        this.panelScrollLock = true;
        listEl.scrollTop = nextScrollTop;
        this.panelScrollLock = false;
    }

    /** 按当前 scrollTop 只渲染可视窗口 + overscan */
    private renderPanelWindow() {
        const count = this.session.count;
        const listEl = this.panelListEl;
        const scrollTop = listEl.scrollTop;
        const viewportHeight = listEl.clientHeight;
        const contentScrollTop = Math.max(0, scrollTop - PANEL_LIST_PADDING);
        const startIndex = Math.max(
            0,
            Math.floor(contentScrollTop / PANEL_ITEM_HEIGHT) - PANEL_OVERSCAN,
        );
        const visibleCount = Math.ceil(viewportHeight / PANEL_ITEM_HEIGHT) + PANEL_OVERSCAN * 2;
        const endIndex = Math.min(count, startIndex + visibleCount);

        const topSpacerHeight = PANEL_LIST_PADDING + startIndex * PANEL_ITEM_HEIGHT;
        const bottomSpacerHeight = PANEL_LIST_PADDING + (count - endIndex) * PANEL_ITEM_HEIGHT;
        const items: string[] = [];
        for (let i = startIndex; i < endIndex; i++) {
            items.push(this.renderPanelItemHtml(i));
        }

        listEl.innerHTML =
            `<div class="search-panel__spacer" style="height:${topSpacerHeight}px"></div>` +
            items.join("") +
            `<div class="search-panel__spacer" style="height:${bottomSpacerHeight}px"></div>`;
    }

    private handlePanelScroll = () => {
        if (this.panelScrollLock || !this.panelOpen || this.session.count === 0) return;
        if (this.panelScrollRaf !== undefined) return;
        this.panelScrollRaf = requestAnimationFrame(() => {
            this.panelScrollRaf = undefined;
            this.renderPanelWindow();
        });
    };

    private renderPanel(scrollToActive = true) {
        if (!this.panelOpen) return;
        if (this.panelScrollRaf !== undefined) {
            cancelAnimationFrame(this.panelScrollRaf);
            this.panelScrollRaf = undefined;
        }
        const emptyText = this.plugin.i18n.resultsPanelEmpty;
        if (this.session.count === 0) {
            this.panelScrollLock = true;
            this.panelListEl.scrollTop = 0;
            this.panelScrollLock = false;
            this.panelListEl.innerHTML = `<div class="search-panel__empty">${emptyText}</div>`;
            return;
        }
        this.clampPanelScroll();
        if (scrollToActive) {
            this.scrollActiveIntoView();
        }
        this.renderPanelWindow();
    }

    private togglePanel = () => {
        this.panelOpen = !this.panelOpen;
        this.panelEl.classList.toggle("fn__none", !this.panelOpen);
        this.panelToggleEl.classList.toggle("search-panel-toggle--on", this.panelOpen);
        if (this.panelOpen) {
            this.renderPanel();
        }
    };

    private handlePanelClick = (event: MouseEvent) => {
        const target = (event.target as HTMLElement).closest(".search-panel__item") as HTMLElement | null;
        if (!target) return;
        const index = Number(target.dataset.index);
        if (Number.isNaN(index)) return;
        this.session.goTo(this.sessionCtx(), index);
        this.updateCount();
        this.renderPanel();
        this.rememberResultIndex(this.searchText, this.session.index);
    };

    /**
     * 执行混合搜索：内核建 Match 列表 + DOM 高亮；change 时定位第一项。
     */
    private async runSearch(value: string, change: boolean, fromHistory = false) {
        const seq = ++this.searchSeq;
        if (change && !fromHistory && this.committedText && this.committedText !== value) {
            this.rememberResultIndex(this.committedText, this.session.index);
        }
        if (change && !fromHistory && value && value !== this.committedText) {
            this.plugin.pushSearchHistory(this.docId, value);
        }
        setHasSearchKeyword(this, value.length > 0);

        const debug = isDebugEnabled();
        const t0 = debug ? performance.now() : 0;
        await this.session.rebuild(this.sessionCtx(), value, change);
        if (this.destroyed || seq !== this.searchSeq) return;

        if (change) {
            this.committedText = value;
        }

        if (change && this.session.count > 0) {
            this.session.locateCurrent(this.sessionCtx(), true);
        } else if (!change && this.session.index >= 1) {
            this.session.locateCurrent(this.sessionCtx(), false);
        }

        if (debug && value) {
            this.lastSearchMs = Math.round(performance.now() - t0);
            console.info(`[highlight-search] search ${this.lastSearchMs}ms`);
        } else {
            this.lastSearchMs = 0;
        }
        this.updateCount();
        this.renderPanel();
    }

    /** 本实例内记住关键词对应的结果索引 */
    private rememberResultIndex(text: string, index: number) {
        if (!text) return;
        this.resultIndexByText.set(text, Math.max(0, index));
    }

    /** 用历史关键词（或草稿）恢复输入、高亮，并尽量还原本实例记住的结果索引 */
    private async restoreHistoryText(text: string, fromHistory: boolean) {
        this.searchText = text;
        this.input.value = text;
        await this.runSearch(text, true, fromHistory);
        if (fromHistory) {
            const savedIndex = this.resultIndexByText.get(text) ?? 0;
            if (this.session.count > 0 && savedIndex >= 1) {
                this.session.index = Math.min(savedIndex, this.session.count);
                this.updateCount();
                this.session.locateCurrent(this.sessionCtx(), true);
                this.renderPanel();
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
            this.rememberResultIndex(this.historyDraft, this.session.index);
            this.historyCursor = this.historyView.length - 1;
            if (this.historyView[this.historyCursor] === this.historyDraft) {
                if (this.historyCursor === 0) return;
                this.historyCursor -= 1;
            }
        } else {
            this.rememberResultIndex(this.historyView[this.historyCursor], this.session.index);
            const next = this.historyCursor + direction;
            if (next < 0) return;
            if (next >= this.historyView.length) {
                this.historyCursor = -1;
                this.historyView = [];
                void this.restoreHistoryText(this.historyDraft, true);
                return;
            }
            this.historyCursor = next;
        }

        void this.restoreHistoryText(this.historyView[this.historyCursor], true);
    }

    private handleInput = () => {
        if (this.historyCursor >= 0) {
            this.rememberResultIndex(this.historyView[this.historyCursor], this.session.index);
        } else if (this.committedText) {
            this.rememberResultIndex(this.committedText, this.session.index);
        }
        this.searchText = this.input.value;
        this.historyCursor = -1;
        this.historyView = [];
        clearTimeout(this.typingTimer);
        this.typingTimer = window.setTimeout(() => {
            void this.runSearch(this.searchText, true);
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
                this.goPrevious();
            } else if (!event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                this.goNext();
            }
        } else if (event.key === "Escape") {
            if (!event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                this.clickClose();
            }
        }
    };

    private handleDragMouseDown = (event: MouseEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();

        this.dragging = true;
        this.dragStartX = event.clientX;
        this.dragStartY = event.clientY;
        // 以搜索条为准取初始位置（结果面板 absolute 不影响容器边框盒）
        const rect = this.dialogEl.getBoundingClientRect();
        this.dragInitialLeft = rect.left;
        this.dragInitialTop = rect.top;
        document.body.classList.add("jchs-dragging");
    };

    /** 双击计数区：清除拖拽定位，回到默认右上角 */
    private handleDragDblClick = (event: MouseEvent) => {
        event.preventDefault();
        this.resetPosition();
    };

    private handlePointerMouseMove = (event: MouseEvent) => {
        if (this.dragging) {
            const deltaX = event.clientX - this.dragStartX;
            const deltaY = event.clientY - this.dragStartY;
            const el = this.element;
            // 移动整个容器，结果面板随搜索条一起走
            el.style.position = "fixed";
            el.style.left = `${this.dragInitialLeft + deltaX}px`;
            el.style.top = `${this.dragInitialTop + deltaY}px`;
            // 覆盖 CSS 里的 right，避免 left+right 同时生效把宽度拉断
            el.style.right = "auto";
            el.style.zIndex = "9999";
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
        return this.inputBoxEl.getBoundingClientRect().width || DEFAULT_INPUT_WIDTH;
    }

    private getHostEl(): HTMLElement {
        return (this.element.parentElement ?? this.protyleEl) as HTMLElement;
    }

    private getMaxInputWidth(): number {
        const actions = this.element.querySelector(".search-actions") as HTMLElement | null;
        const actionsWidth = actions?.getBoundingClientRect().width ?? 120;
        const chrome = 24;
        const hostWidth = this.element.style.position === "fixed"
            ? window.innerWidth
            : this.getHostEl().clientWidth;
        return Math.max(MIN_INPUT_WIDTH, hostWidth - actionsWidth - chrome);
    }

    private applyInputWidth(width: number) {
        const next = Math.min(Math.max(width, MIN_INPUT_WIDTH), this.getMaxInputWidth());
        if (this.preferredInputWidth === DEFAULT_INPUT_WIDTH && next === DEFAULT_INPUT_WIDTH) {
            this.inputBoxEl.style.width = "";
        } else {
            this.inputBoxEl.style.width = `${next}px`;
        }
        return next;
    }

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
        const el = this.element;
        this.resizeHasFixedLeft = el.style.position === "fixed" && !!el.style.left;
        this.resizeStartDialogLeft = this.resizeHasFixedLeft
            ? el.getBoundingClientRect().left
            : 0;
        this.dialogEl.classList.add("search-dialog--resizing");
        document.body.classList.add("jchs-resizing");
    };

    private handleSashMouseMove = (event: MouseEvent) => {
        if (!this.resizing) return;

        const nextWidth = this.applyInputWidth(
            this.resizeStartInputWidth + this.resizeStartX - event.clientX,
        );
        this.preferredInputWidth = nextWidth;
        if (this.resizeHasFixedLeft) {
            const widthDelta = nextWidth - this.resizeStartInputWidth;
            this.element.style.left = `${this.resizeStartDialogLeft - widthDelta}px`;
        }
    };

    private handleSashMouseUp = () => {
        if (!this.resizing) return;
        this.resizing = false;
        this.dialogEl.classList.remove("search-dialog--resizing");
        document.body.classList.remove("jchs-resizing");
        this.syncInputWidthToHost();
    };

    private handleSashDblClick = (event: MouseEvent) => {
        event.preventDefault();
        const prevWidth = this.getInputWidth();
        this.preferredInputWidth = DEFAULT_INPUT_WIDTH;
        const nextWidth = this.applyInputWidth(DEFAULT_INPUT_WIDTH);
        const el = this.element;
        if (el.style.position === "fixed" && el.style.left) {
            const left = el.getBoundingClientRect().left;
            el.style.left = `${left - (nextWidth - prevWidth)}px`;
        }
    };

    private eventBusHandle = (event: CustomEvent) => {
        if (["savedoc", "rename"].includes(event.detail?.cmd)) {
            // 文档内容变更：重建 Match 列表，尽量保持 index
            clearTimeout(this.typingTimer);
            this.typingTimer = window.setTimeout(() => {
                void this.runSearch(this.searchText, false);
            }, this.doneTypingInterval);
        } else if (["loaded-protyle-dynamic", "loaded-protyle-static", "switch-protyle-mode"].includes(event.type)) {
            const protyle = event.detail?.protyle;
            const protyleElement = protyle?.element;
            if (!protyleElement || (!isMobile() && !protyleElement.contains(this.element))) return;
            const rootID = protyle?.block?.rootID;
            const notebookId = protyle?.notebookId;
            const path = protyle?.path;
            if (typeof rootID === "string" && rootID) {
                this.docId = rootID;
            }
            if (typeof notebookId === "string" && notebookId) {
                this.notebookId = notebookId;
            }
            if (typeof path === "string") {
                this.docPath = path;
            }
            clearTimeout(this.typingTimer);
            this.typingTimer = window.setTimeout(() => {
                // 只重扫 DOM 高亮，不重置 index
                this.session.refreshDomHighlights(this.sessionCtx());
                this.session.tryResolvePending(this.sessionCtx(), false);
                this.updateCount();
                this.renderPanel();
            }, this.doneTypingInterval);
        }
    };

    /** 跳转上一处匹配；不抢焦点，供快捷键在编辑器内调用 */
    goPrevious = () => {
        this.session.goPrevious(this.sessionCtx());
        this.updateCount();
        this.renderPanel();
        this.rememberResultIndex(this.searchText, this.session.index);
    };

    /** 跳转下一处匹配；不抢焦点，供快捷键在编辑器内调用 */
    goNext = () => {
        this.session.goNext(this.sessionCtx());
        this.updateCount();
        this.renderPanel();
        this.rememberResultIndex(this.searchText, this.session.index);
    };

    private clickClose = () => {
        this.plugin.closeCurrentSearchDialog(this.element);
    };
}
