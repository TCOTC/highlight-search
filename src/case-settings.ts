const STORAGE_NAME = "settings.json";

export interface PluginSettings {
    /** 调试信息：跳转日志、端到端查询耗时；默认关闭以避免无关计算 */
    debug: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
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

/** 是否开启调试信息（跳转日志、查询耗时） */
export function isDebugEnabled(): boolean {
    return cached.debug;
}

export async function loadSettings(store: DataStore): Promise<PluginSettings> {
    try {
        const data = await store.loadData(STORAGE_NAME);
        if (data && typeof data === "object") {
            const next = { ...DEFAULT_SETTINGS };
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

export function setDebugEnabled(enabled: boolean) {
    cached = { ...cached, debug: enabled };
}
