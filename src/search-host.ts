import type { App } from "siyuan";
import { getSearchBox } from "./search-box";
import { SearchHistoryStore } from "./search-history";
import { CLASS_NAME } from "./utils";
import type { SearchHost } from "./types";

/** 管理搜索框关闭、历史存储与插件卸载清理 */
export class SearchHostImpl implements SearchHost {
    private readonly history = new SearchHistoryStore();
    private app!: App;
    i18n: Record<string, string> = {};

    bind(app: App, i18n: Record<string, string>) {
        this.app = app;
        this.i18n = i18n;
    }

    getApp(): App {
        return this.app;
    }

    async loadHistory() {
        await this.history.load();
    }

    getSearchHistory(docId: string): string[] {
        return this.history.getForDoc(docId);
    }

    pushSearchHistory(docId: string, text: string) {
        this.history.push(docId, text);
    }

    closeCurrentSearchDialog(element: Element) {
        getSearchBox(element)?.destroy();
        element.remove();
    }

    dispose() {
        document.querySelectorAll(`.${CLASS_NAME}`).forEach((element) => {
            getSearchBox(element)?.destroy();
            element.remove();
        });
    }

    /** 卸载时删除搜索历史 storage */
    removePersistedStorage() {
        this.history.remove();
    }
}
