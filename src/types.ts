/** 事件总线回调 */
export type EventBusCallback = (event: CustomEvent) => void;

/** 搜索历史条目：文档 ID + 搜索关键词 */
export interface SearchHistoryEntry {
    docId: string;
    text: string;
}

/** SearchBox 依赖的宿主能力 */
export interface SearchHost {
    closeCurrentSearchDialog(element: Element): void;
    /** 指定文档下的搜索关键词历史（旧 → 新） */
    getSearchHistory(docId: string): string[];
    /** 记录搜索关键词并持久化 */
    pushSearchHistory(docId: string, text: string): void;
    /** 思源 App，用于 openTab / openMobileFileById */
    getApp(): import("siyuan").App;
    /** i18n 文案 */
    i18n: Record<string, string>;
}

/** 思源插件事件总线的最小接口 */
export interface EventBusLike {
    on(event: string, callback: EventBusCallback): void;
    off(event: string, callback: EventBusCallback): void;
}
