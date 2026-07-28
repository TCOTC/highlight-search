import type { CaseSensitiveMode } from "./match-text";

const STORAGE_NAME = "settings.json";

export interface PluginSettings {
    /** 英文搜索区分大小写：跟随思源 / 开启 / 关闭 */
    caseSensitive: CaseSensitiveMode;
    /** 调试信息：跳转日志、端到端查询耗时；默认关闭以避免无关计算 */
    debug: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
    caseSensitive: "follow",
    debug: false,
};

type DataStore = {
    loadData(storageName: string): Promise<any>;
    saveData(storageName: string, content: any): Promise<any>;
};

let cached: PluginSettings = { ...DEFAULT_SETTINGS };

export function getSettings(): PluginSettings {
    return cached;
}

export function getCaseMode(): CaseSensitiveMode {
    return cached.caseSensitive;
}

/** 是否开启调试信息（跳转日志、查询耗时） */
export function isDebugEnabled(): boolean {
    return cached.debug;
}

export async function loadSettings(store: DataStore): Promise<PluginSettings> {
    try {
        const data = await store.loadData(STORAGE_NAME);
        if (data && typeof data === "object") {
            const next = { ...DEFAULT_SETTINGS };
            const mode = (data as PluginSettings).caseSensitive;
            if (mode === "follow" || mode === "on" || mode === "off") {
                next.caseSensitive = mode;
            }
            if (typeof (data as PluginSettings).debug === "boolean") {
                next.debug = (data as PluginSettings).debug;
            }
            cached = next;
        }
    } catch {
        cached = { ...DEFAULT_SETTINGS };
    }
    return cached;
}

export async function saveSettings(store: DataStore, next: PluginSettings): Promise<void> {
    cached = { ...next };
    await store.saveData(STORAGE_NAME, cached);
}

export function setCaseMode(mode: CaseSensitiveMode) {
    cached = { ...cached, caseSensitive: mode };
}

export function setDebugEnabled(enabled: boolean) {
    cached = { ...cached, debug: enabled };
}
