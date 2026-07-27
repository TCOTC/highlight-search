import { isMobile } from "./index";
import {
    calculateSearchResults,
    clearHighlight,
    highlightHitResult,
    scrollIntoRanges,
} from "./search";

const PLACEHOLDER = "🔍︎ (Shift) + Enter";

export class SearchBox {
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
            this.runHighlight(opts.presetText, true);
        } else {
            this.input.focus();
            this.input.select();
        }
    }

    destroy() {
        clearHighlight();
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
        if (change) {
            this.resultIndex = 0;
            this.resultCount = 0;
            this.updateCount();
        }
        const ranges = highlightHitResult(this.edit, value);
        this.applyRanges(ranges, false);
        if (ranges.length > 0) {
            this.plugin?.updateLastHighlightComponent?.(this.element);
        }
    }

    private runCalculate(value: string, change: boolean) {
        if (change) {
            this.resultIndex = 0;
            this.resultCount = 0;
            this.updateCount();
        }
        const ranges = calculateSearchResults(this.edit, value);
        this.applyRanges(ranges, false);
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
                    this.runHighlight(this.searchText, false);
                    if (this.resultIndex >= 1) {
                        this.scrollToResult(this.resultIndex - 1, false);
                    }
                } else {
                    this.runCalculate(this.searchText, false);
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
                    this.runHighlight(this.searchText, false);
                } else {
                    this.runCalculate(this.searchText, false);
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
        this.scrollToResult(this.resultIndex - 1);
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
        this.scrollToResult(this.resultIndex - 1);
    }

    private clickClose = () => {
        clearHighlight();
        this.plugin?.closeCurrentSearchDialog?.(this.element);
    }

    private scrollToResult(index: number, scroll: boolean = true) {
        scrollIntoRanges(this.edit, this.resultRange, index, scroll);
        this.plugin?.updateLastHighlightComponent?.(this.element);
    }
}
