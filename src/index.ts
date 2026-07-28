import { Constants, getActiveEditor, Plugin, Setting, showMessage } from "siyuan";
import {
    getCaseMode,
    loadSettings,
    saveSettings,
    setCaseMode,
    type PluginSettings,
} from "./case-settings";
import type { CaseSensitiveMode } from "./match-text";
import { getSearchBox, SearchBox } from "./search-box";
import { SearchHostImpl } from "./search-host";
import { CLASS_NAME, isHighlightApiSupported, isMobile } from "./utils";
import "./index.css";

export default class PluginHighlight extends Plugin {
    private host!: SearchHostImpl;

    async onload() {
        this.host = new SearchHostImpl();
        this.host.bind(this.app, this.i18n as Record<string, string>);

        await loadSettings(this);
        await this.host.loadHistory();
        this.setupSetting();

        this.addCommand({
            langKey: "showDialog",
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

        this.addTopBar({
            icon: `<svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M9.29289 1.29289C9.48043 1.10536 9.73478 1 10 1H18C19.6569 1 21 2.34315 21 4V8C21 8.55228 20.5523 9 20 9C19.4477 9 19 8.55228 19 8V4C19 3.44772 18.5523 3 18 3H11V8C11 8.55228 10.5523 9 10 9H5V20C5 20.5523 5.44772 21 6 21H10C10.5523 21 11 21.4477 11 22C11 22.5523 10.5523 23 10 23H6C4.34315 23 3 21.6569 3 20V8C3 7.73478 3.10536 7.48043 3.29289 7.29289L9.29289 1.29289ZM6.41421 7H9V4.41421L6.41421 7ZM20.1716 18.7574C20.6951 17.967 21 17.0191 21 16C21 13.2386 18.7614 11 16 11C13.2386 11 11 13.2386 11 16C11 18.7614 13.2386 21 16 21C17.0191 21 17.967 20.6951 18.7574 20.1716L21.2929 22.7071C21.6834 23.0976 22.3166 23.0976 22.7071 22.7071C23.0976 22.3166 23.0976 21.6834 22.7071 21.2929L20.1716 18.7574ZM13 16C13 14.3431 14.3431 13 16 13C17.6569 13 19 14.3431 19 16C19 17.6569 17.6569 19 16 19C14.3431 19 13 17.6569 13 16Z"/></svg>`,
            title: this.i18n.topBarTitle,
            position: "right",
            callback: () => {
                if (isMobile()) {
                    this.closePanel();
                }
                this.addSearchElement(true);
            },
        });

        console.log(this.displayName, "plugin loaded");
    }

    onunload() {
        this.host?.dispose();

        console.log(this.displayName, "plugin unloaded");
    }

    uninstall() {
        console.log(this.displayName, "plugin uninstalled");
    }

    /** 设置面板：区分大小写 https://github.com/TCOTC/highlight-search/issues/14 */
    private setupSetting() {
        const i18n = this.i18n as Record<string, string>;
        let draft: PluginSettings = { caseSensitive: getCaseMode() };

        this.setting = new Setting({
            confirmCallback: () => {
                setCaseMode(draft.caseSensitive);
                void saveSettings(this, draft);
            },
        });

        this.setting.addItem({
            title: i18n.settingCaseSensitive || "Case sensitive",
            description: i18n.settingCaseSensitiveDesc || "",
            createActionElement: () => {
                const select = document.createElement("select");
                select.className = "b3-select";
                const options: Array<{ value: CaseSensitiveMode; label: string }> = [
                    { value: "follow", label: i18n.caseFollow || "Follow SiYuan" },
                    { value: "on", label: i18n.caseOn || "On" },
                    { value: "off", label: i18n.caseOff || "Off" },
                ];
                for (const opt of options) {
                    const option = document.createElement("option");
                    option.value = opt.value;
                    option.textContent = opt.label;
                    if (opt.value === draft.caseSensitive) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                }
                select.addEventListener("change", () => {
                    draft = { caseSensitive: select.value as CaseSensitiveMode };
                });
                return select;
            },
        });
    }

    /** 移动端关闭侧栏/菜单面板（对齐思源 closePanel） */
    closePanel() {
        document.getElementById("menu").style.transform = "";
        document.getElementById("sidebar").style.transform = "";
        document.getElementById("model").style.transform = "";
        const maskElement = document.querySelector(".side-mask") as HTMLElement;
        setTimeout(() => {
            maskElement.classList.add("fn__none");
        }, Constants.TIMEOUT_TRANSITION);
        maskElement.style.opacity = "";
        (window as any).siyuan.menus.menu.remove();
    }

    private getActiveSearchBox(): SearchBox | undefined {
        const editor = getActiveEditor();
        if (!editor) return;

        const existingElement = isMobile()
            ? document.querySelector(`.${CLASS_NAME}`)
            : editor.protyle.element.querySelector(`.${CLASS_NAME}`);
        if (!existingElement) return;

        return getSearchBox(existingElement);
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
        const text = selection.toString();
        return text.trim() || text;
    }

    addSearchElement(isFromTopBar: boolean) {
        // https://github.com/TCOTC/highlight-search/issues/7
        if (!isHighlightApiSupported()) {
            showMessage(this.displayName + ": " + this.i18n.highlightApiUnsupported, 6000, "error");
        }

        const editor = getActiveEditor();
        if (!editor) {
            console.warn("no protyle found");
            return;
        }

        const mobile = isMobile();
        const protyleEl = editor.protyle.element;
        const selectedText = isFromTopBar ? "" : this.getEditorSelectedText(protyleEl);
        const existingElement = mobile ? document.querySelector(`.${CLASS_NAME}`) : protyleEl.querySelector(`.${CLASS_NAME}`);
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
                placeholder: this.i18n.searchPlaceholder,
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
