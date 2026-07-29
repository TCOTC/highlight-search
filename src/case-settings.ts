/** 插件设置持久化文件名（petal 目录下） */
export const SETTINGS_STORAGE_NAME = "settings.json";

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
    removeData(storageName: string): Promise<any>;
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
        const data = await store.loadData(SETTINGS_STORAGE_NAME);
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
    await store.saveData(SETTINGS_STORAGE_NAME, cached);
}

/** 卸载时删除 petal 下的设置文件 */
export async function removeSettings(store: DataStore): Promise<void> {
    cached = { ...DEFAULT_SETTINGS };
    await store.removeData(SETTINGS_STORAGE_NAME);
}

export function setDebugEnabled(enabled: boolean) {
    cached = { ...cached, debug: enabled };
}
