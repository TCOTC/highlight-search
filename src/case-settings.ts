import type { CaseSensitiveMode } from "./match-text";

const STORAGE_NAME = "settings.json";

export interface PluginSettings {
    /** 英文搜索区分大小写：跟随思源 / 开启 / 关闭 */
    caseSensitive: CaseSensitiveMode;
}

const DEFAULT_SETTINGS: PluginSettings = {
    caseSensitive: "follow",
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

export async function loadSettings(store: DataStore): Promise<PluginSettings> {
    try {
        const data = await store.loadData(STORAGE_NAME);
        if (data && typeof data === "object") {
            const mode = (data as PluginSettings).caseSensitive;
            if (mode === "follow" || mode === "on" || mode === "off") {
                cached = { caseSensitive: mode };
            }
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
