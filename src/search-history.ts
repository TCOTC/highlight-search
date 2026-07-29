import { fetchPost, fetchSyncPost } from "siyuan";
import type { SearchHistoryEntry } from "./types";

/** localStorage 键名（勿与思源内置 local-* 冲突） */
const STORAGE_KEY = "local-highlight-search-history";
/** 全局最近历史条数上限 */
const MAX_SEARCH_HISTORY = 100;

/**
 * 搜索历史：内存中使用，经内核 storage API 持久化。
 * 每条为文档 ID + 关键词；↑↓ 时按当前文档过滤。
 * 写入时不传 app，当前前端也会收到推送并更新 window.siyuan.storage。
 */
export class SearchHistoryStore {
    private entries: SearchHistoryEntry[] = [];

    /** 插件加载时从内核读取历史 */
    async load() {
        try {
            const response = await fetchSyncPost("/api/storage/getLocalStorageVal", {
                key: STORAGE_KEY,
            });
            this.entries = normalizeEntries(response?.data);
        } catch {
            this.entries = [];
        }
    }

    /** 某文档下的关键词列表（旧 → 新） */
    getForDoc(docId: string): string[] {
        if (!docId) return [];
        return this.entries
            .filter((entry) => entry.docId === docId)
            .map((entry) => entry.text);
    }

    /**
     * 记录一次搜索：相同「文档 + 关键词」移到末尾；
     * 超出上限时丢掉最旧的；变更后写入 storage。
     */
    push(docId: string, text: string) {
        if (!docId || !text) return;

        const existing = this.entries.findIndex(
            (entry) => entry.docId === docId && entry.text === text,
        );
        if (existing >= 0) {
            this.entries.splice(existing, 1);
        }
        this.entries.push({ docId, text });
        while (this.entries.length > MAX_SEARCH_HISTORY) {
            this.entries.shift();
        }
        this.persist();
    }

    private persist() {
        fetchPost("/api/storage/setLocalStorageVal", {
            key: STORAGE_KEY,
            val: this.entries,
        });
    }

    /** 卸载时清空内存并从内核 localStorage 删除 */
    remove() {
        this.entries = [];
        fetchPost("/api/storage/removeLocalStorageVal", {
            key: STORAGE_KEY,
        });
        const storage = (window as any).siyuan?.storage;
        if (storage && STORAGE_KEY in storage) {
            delete storage[STORAGE_KEY];
        }
    }
}

/** 校验并截断历史数组 */
function normalizeEntries(data: unknown): SearchHistoryEntry[] {
    if (!Array.isArray(data)) return [];
    return data
        .filter((item): item is SearchHistoryEntry =>
            !!item &&
            typeof item === "object" &&
            typeof item.docId === "string" && !!item.docId &&
            typeof item.text === "string" && !!item.text,
        )
        .slice(-MAX_SEARCH_HISTORY);
}
