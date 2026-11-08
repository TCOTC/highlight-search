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
import { isDocumentTabProtyle } from "./block-dom";
import { CLASS_NAME, isHighlightApiSupported, isMobile } from "./utils";
import "./index.scss";

/** 反链浮窗、侧栏、全局搜索预览与文档标题片段等编辑器不属于当前页签文档 */
function isDocumentTabEditor(editor: Protyle | undefined): editor is Protyle {
    const element = editor?.protyle?.element;
    return !!element?.isConnected && isDocumentTabProtyle(element);
}

function getDocumentTabEditors(): Protyle[] {
    return getAllEditor().filter(isDocumentTabEditor);
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
                const editor = this.getDocumentEditor();
                const selectedText = editor
                    ? this.getEditorSelectedText(editor.protyle.element)
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
        const editor = this.getDocumentEditor();
        if (!editor) return;

        const existingElement = this.getSearchBoxElement(editor);
        if (!existingElement) return;

        return getSearchBox(existingElement);
    }

    /** 当前页签文档编辑器；焦点在反链浮窗等非文档编辑器时回退到活动窗口 */
    private getDocumentEditor(): Protyle | undefined {
        const active = getActiveEditor();
        if (isMobile()) {
            return active;
        }
        if (isDocumentTabEditor(active)) {
            return active;
        }

        const editors = getDocumentTabEditors();
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (range) {
            const editor = editors.find(
                (item) => !item.protyle.element.classList.contains("fn__none") &&
                    item.protyle.element.contains(range.startContainer),
            );
            if (editor) return editor;
        }

        // 反链浮窗等占用了选区时，按活动窗口当前页签回退，避免落到同窗口其它文档
        const focusedID = document.querySelector(".layout__wnd--active .layout-tab-bar .item--focus")
            ?.getAttribute("data-id");
        if (focusedID) {
            const editor = editors.find(
                (item) => item.protyle.element.closest(".fn__flex-1[data-id]")?.getAttribute("data-id") === focusedID,
            );
            if (editor) return editor;
        }

        const activeWnd = document.querySelector(".layout__wnd--active");
        return editors.find((item) => activeWnd?.contains(item.protyle.element)) ||
            editors.find((item) => item.protyle.element.getBoundingClientRect().height > 0) ||
            editors[0];
    }

    private getSearchBoxElement(editor: Protyle): Element | null {
        return isMobile()
            ? document.querySelector(`.${CLASS_NAME}`)
            : editor.protyle.element.querySelector(`.${CLASS_NAME}`);
    }

    private getEditorSelectedText(protyleEl: Element): string {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return "";
        }
        const range = selection.getRangeAt(0);
        if (!protyleEl.contains(range.commonAncestorContainer)) {
            return "";
        }
        const ancestor = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
            ? range.commonAncestorContainer.parentElement
            : range.commonAncestorContainer as Element;
        // 文档标题不在搜索范围内，标题里的选区不作为预设关键词
        if (ancestor?.closest(".protyle-title")) {
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

        const editor = this.getDocumentEditor();
        if (!editor) {
            console.warn("no protyle found");
            return;
        }

        const mobile = isMobile();
        const protyleEl = editor.protyle.element;
        const selectedText = isFromTopBar ? "" : this.getEditorSelectedText(protyleEl);
        const existingElement = this.getSearchBoxElement(editor);
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
                protyleEl.appendChild(container);
            }

            new SearchBox({
                protyleEl,
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
