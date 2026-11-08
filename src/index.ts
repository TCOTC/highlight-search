import { Constants, getAllEditor, getActiveEditor, Plugin, Setting, showMessage } from "siyuan";
import type { Protyle } from "siyuan";
import {
    getSettings,
    loadSettings,
    removeSettings,
    saveSettings,
    setDebugEnabled,
    type PluginSettings,
} from "./case-settings";
import { PLUGIN_ICON_SYMBOLS } from "./icons";
import { getSearchBox, SearchBox } from "./search-box";
import { SearchHostImpl } from "./search-host";
import {
    isBacklinkPopoverScope,
    isOpenPopover,
    isSearchableProtyle,
} from "./block-dom";
import { CLASS_NAME, isHighlightApiSupported, isMobile } from "./utils";
import "./index.scss";

/**
 * 搜索目标：`editor` 提供文档信息，`scopeEl` 是实际搜索与挂载范围。
 * 反链浮窗里每条反链各自一个 Protyle，但按整个浮窗一起搜索。
 */
interface SearchTarget {
    editor: Protyle;
    scopeEl: Element;
}

/** 可搜索的编辑器：排除片段编辑器、嵌套编辑器与后台页签里不可见的编辑器 */
function isSearchableEditor(editor: Protyle | undefined): editor is Protyle {
    const element = editor?.protyle?.element;
    return !!element && isSearchableProtyle(element);
}

function getSearchableEditors(): Protyle[] {
    return getAllEditor().filter(isSearchableEditor);
}

/** 反链浮窗内的编辑器提升为整个浮窗范围 */
function toSearchTarget(editor: Protyle): SearchTarget {
    const element = editor.protyle.element;
    return {
        editor,
        scopeEl: element.closest(".block__popover--backlinks") ?? element,
    };
}

/**
 * 在浮窗内选取搜索目标：反链浮窗返回整个浮窗，悬浮预览返回当前正文。
 * 多个反链条目时用首个条目提供文档信息。
 */
function pickPopoverTarget(popover: Element, editors: Protyle[]): SearchTarget | undefined {
    const scoped = editors.filter((item) => popover.contains(item.protyle.element));
    const editor = scoped[0];
    if (!editor) return undefined;
    return isBacklinkPopoverScope(popover) ? { editor, scopeEl: popover } : toSearchTarget(editor);
}

/**
 * 顶层打开中的块浮窗。钉住的浮窗会与文档并行使用，不抢占当前文档。
 * 点击反链图标等方式打开浮窗后焦点可能仍在文档里，此时也要能在浮窗里搜索。
 */
function getOpenPopoverTarget(editors: Protyle[]): SearchTarget | undefined {
    const popovers = document.querySelectorAll<HTMLElement>(".block__popover");
    for (let index = popovers.length - 1; index >= 0; index--) {
        const popover = popovers[index];
        if (!isOpenPopover(popover)) {
            continue;
        }
        const target = pickPopoverTarget(popover, editors);
        if (target) return target;
    }
    return undefined;
}

export default class PluginHighlight extends Plugin {
    private host!: SearchHostImpl;

    async onload() {
        this.host = new SearchHostImpl();
        this.host.bind(this.app, this.i18n as Record<string, string>);

        this.addIcons(PLUGIN_ICON_SYMBOLS);

        this.addCommand({
            langKey: "search",
            hotkey: "⌥⇧⌘F",
            callback: () => {
                this.addSearchElement(false);
            },
        });
        // https://github.com/TCOTC/highlight-search/issues/12
        this.addCommand({
            langKey: "findPrevious",
            hotkey: "",
            callback: () => {
                this.getActiveSearchBox()?.goPrevious();
            },
        });
        this.addCommand({
            langKey: "findNext",
            hotkey: "",
            callback: () => {
                this.getActiveSearchBox()?.goNext();
            },
        });
        this.addCommand({
            langKey: "toggleReplace",
            hotkey: "⌥⇧⌘R",
            callback: () => {
                const target = this.getSearchTarget();
                const selectedText = target
                    ? this.getEditorSelectedText(target.scopeEl)
                    : "";
                const existing = this.getActiveSearchBox();
                if (!existing) {
                    // 尚未弹出：打开并展开替换行；有选区则填入搜索框并聚焦替换框
                    this.addSearchElement(false);
                    this.getActiveSearchBox()?.toggleReplaceRow(true, {
                        focus: selectedText ? "replace" : "find",
                    });
                    return;
                }
                if (selectedText) {
                    existing.setSearchText(selectedText);
                    existing.toggleReplaceRow(true, { focus: "replace" });
                    return;
                }
                existing.cycleFindReplaceFocus();
            },
        });
        this.addCommand({
            langKey: "replaceCurrent",
            hotkey: "",
            callback: () => {
                void this.getActiveSearchBox()?.replaceCurrent();
            },
        });

        this.addTopBar({
            icon: `<svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M9.29289 1.29289C9.48043 1.10536 9.73478 1 10 1H18C19.6569 1 21 2.34315 21 4V8C21 8.55228 20.5523 9 20 9C19.4477 9 19 8.55228 19 8V4C19 3.44772 18.5523 3 18 3H11V8C11 8.55228 10.5523 9 10 9H5V20C5 20.5523 5.44772 21 6 21H10C10.5523 21 11 21.4477 11 22C11 22.5523 10.5523 23 10 23H6C4.34315 23 3 21.6569 3 20V8C3 7.73478 3.10536 7.48043 3.29289 7.29289L9.29289 1.29289ZM6.41421 7H9V4.41421L6.41421 7ZM20.1716 18.7574C20.6951 17.967 21 17.0191 21 16C21 13.2386 18.7614 11 16 11C13.2386 11 11 13.2386 11 16C11 18.7614 13.2386 21 16 21C17.0191 21 17.967 20.6951 18.7574 20.1716L21.2929 22.7071C21.6834 23.0976 22.3166 23.0976 22.7071 22.7071C23.0976 22.3166 23.0976 21.6834 22.7071 21.2929L20.1716 18.7574ZM13 16C13 14.3431 14.3431 13 16 13C17.6569 13 19 14.3431 19 16C19 17.6569 17.6569 19 16 19C14.3431 19 13 17.6569 13 16Z"/></svg>`,
            title: (this.i18n as Record<string, string>).topBarTitle,
            position: "right",
            callback: () => {
                if (isMobile()) {
                    this.closePanel();
                }
                this.addSearchElement(true);
            },
        });

        await loadSettings(this);
        await this.host.loadHistory();
        this.setupSetting();

        console.log(this.displayName, "plugin loaded");
    }

    onunload() {
        this.host?.dispose();

        console.log(this.displayName, "plugin unloaded");
    }

    uninstall() {
        void removeSettings(this);
        this.host?.removePersistedStorage();

        console.log(this.displayName, "plugin uninstalled");
    }

    private setupSetting() {
        const i18n = this.i18n as Record<string, string>;
        let draft: PluginSettings = { ...getSettings() };

        this.setting = new Setting({
            confirmCallback: () => {
                setDebugEnabled(draft.debug);
                void saveSettings(this, draft);
            },
        });

        this.setting.addItem({
            title: i18n.settingDebug,
            description: i18n.settingDebugDesc,
            createActionElement: () => {
                const input = document.createElement("input");
                input.className = "b3-switch fn__flex-center";
                input.type = "checkbox";
                input.checked = draft.debug;
                input.addEventListener("change", () => {
                    draft = { ...draft, debug: input.checked };
                });
                return input;
            },
        });
    }

    /** 移动端关闭侧栏/菜单面板（对齐思源 closePanel） */
    closePanel() {
        const menuElement = document.getElementById("menu");
        if (menuElement) {
            menuElement.style.removeProperty("transform");
            menuElement.style.removeProperty("z-index");
        }
        document.getElementById("sidebar")?.style.removeProperty("transform");
        document.getElementById("sidebarRight")?.style.removeProperty("transform");
        document.getElementById("model")?.style.removeProperty("transform");
        const maskElement = document.querySelector(".side-mask") as HTMLElement | null;
        setTimeout(() => {
            maskElement?.classList.add("fn__none");
        }, Constants.TIMEOUT_TRANSITION);
        if (maskElement) {
            maskElement.style.opacity = "";
        }
        (window as any).siyuan.menus.menu.remove();
    }

    private getActiveSearchBox(): SearchBox | undefined {
        // 焦点在搜索框内时直接用它，避免浮窗开启时找不到搜索框
        const focusedElement = document.activeElement?.closest?.(`.${CLASS_NAME}`);
        if (focusedElement) {
            const focusedBox = getSearchBox(focusedElement);
            if (focusedBox) return focusedBox;
        }

        const target = this.getSearchTarget();
        if (!target) return;

        const existingElement = this.getSearchBoxElement(target);
        if (!existingElement) return;

        return getSearchBox(existingElement);
    }

    /**
     * 当前搜索目标：打开的块浮窗优先，否则为活动页签文档。
     * 焦点在侧栏反链等非搜索编辑器时回退到活动窗口。
     */
    private getSearchTarget(): SearchTarget | undefined {
        const active = getActiveEditor();
        if (isMobile()) {
            return active ? { editor: active, scopeEl: active.protyle.element } : undefined;
        }

        const editors = getSearchableEditors();
        // 浮窗打开时优先在浮窗内搜索；正在输入搜索框时不被浮窗抢走
        const typing = document.activeElement?.matches?.("input, textarea") === true;
        if (!typing) {
            const popoverTarget = getOpenPopoverTarget(editors);
            if (popoverTarget) return popoverTarget;
        }

        if (isSearchableEditor(active)) {
            return toSearchTarget(active);
        }

        // 键盘焦点所在编辑器次之：选区偶尔会滞后于焦点
        const focusTarget = document.activeElement;
        if (focusTarget) {
            const focused = editors.find((item) => item.protyle.element.contains(focusTarget));
            if (focused) return toSearchTarget(focused);
        }

        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (range) {
            const editor = editors.find((item) => item.protyle.element.contains(range.startContainer));
            if (editor) return toSearchTarget(editor);
        }

        // 侧栏反链等占用选区时，按活动窗口当前页签回退，避免落到同窗口其它文档
        const focusedID = document.querySelector(".layout__wnd--active .layout-tab-bar .item--focus")
            ?.getAttribute("data-id");
        if (focusedID) {
            const editor = editors.find(
                (item) => item.protyle.element.closest(".fn__flex-1[data-id]")?.getAttribute("data-id") === focusedID,
            );
            if (editor) return toSearchTarget(editor);
        }

        const activeWnd = document.querySelector(".layout__wnd--active");
        const fallback = editors.find((item) => activeWnd?.contains(item.protyle.element)) ||
            editors.find((item) => item.protyle.element.getBoundingClientRect().height > 0) ||
            editors[0];
        return fallback ? toSearchTarget(fallback) : undefined;
    }

    private getSearchBoxElement(target: SearchTarget): Element | null {
        return isMobile()
            ? document.querySelector(`.${CLASS_NAME}`)
            : target.scopeEl.querySelector(`.${CLASS_NAME}`);
    }

    private getEditorSelectedText(scopeEl: Element): string {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return "";
        }
        const range = selection.getRangeAt(0);
        if (!scopeEl.contains(range.commonAncestorContainer)) {
            return "";
        }
        const text = selection.toString();
        return text.trim() || text;
    }

    addSearchElement(isFromTopBar: boolean) {
        // https://github.com/TCOTC/highlight-search/issues/7
        if (!isHighlightApiSupported()) {
            showMessage(this.displayName + ": " + this.i18n.highlightApiUnsupported, 6000, "error");
        }

        const target = this.getSearchTarget();
        if (!target) {
            console.warn("no protyle found");
            showMessage(`[${this.displayName}] ${this.i18n.noProtyle}`, 3000, "info");
            return;
        }

        const mobile = isMobile();
        const { editor, scopeEl } = target;
        const selectedText = isFromTopBar ? "" : this.getEditorSelectedText(scopeEl);
        const existingElement = this.getSearchBoxElement(target);
        const docId = editor.protyle.block.rootID || "";
        const notebookId = editor.protyle.notebookId || "";
        const path = editor.protyle.path || "";

        if (!existingElement) {
            const container = document.createElement("div");
            container.className = `${CLASS_NAME}${mobile ? ` ${CLASS_NAME}--mobile` : ""}`;

            if (mobile) {
                const editorEl = document.querySelector("#editor");
                if (!editorEl) {
                    console.warn("no editor container found");
                    return;
                }
                editorEl.insertAdjacentElement("afterend", container);
            } else {
                scopeEl.appendChild(container);
            }

            new SearchBox({
                protyleEl: scopeEl,
                element: container,
                plugin: this.host,
                eventBus: this.eventBus,
                presetText: selectedText,
                docId,
                notebookId,
                path,
                placeholder: (this.i18n as Record<string, string>).searchPlaceholder,
            });
            return;
        }

        const instance = getSearchBox(existingElement);
        if (!instance) return;

        instance.setDocContext({ docId, notebookId, path });

        if (isFromTopBar) {
            instance.resetPosition();
        }

        if (selectedText) {
            instance.setSearchText(selectedText);
        } else {
            instance.focus();
        }
    }
}
