/** 插件自定义图标 ID（addIcons 注册） */
export const ICON_CASE_SENSITIVE = "iconJCHSCaseSensitive";
export const ICON_WHOLE_WORD = "iconJCHSWholeWord";

/** Lucide case-sensitive / whole-word（24×24 描边图标） */
const CASE_SENSITIVE_PATHS = `
<path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16"/>
<path d="M22 9v7"/>
<path d="M3.304 13h6.392"/>
<circle cx="18.5" cy="12.5" r="3.5"/>
`;

const WHOLE_WORD_PATHS = `
<circle cx="7" cy="12" r="3"/>
<path d="M10 9v6"/>
<circle cx="17" cy="12" r="3"/>
<path d="M14 7v8"/>
<path d="M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1"/>
`;

const STROKE_ICON_ATTRS = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`;

/** addIcons 注册用 symbol */
export const PLUGIN_ICON_SYMBOLS = `
<symbol id="${ICON_CASE_SENSITIVE}" viewBox="0 0 24 24">${CASE_SENSITIVE_PATHS}</symbol>
<symbol id="${ICON_WHOLE_WORD}" viewBox="0 0 24 24">${WHOLE_WORD_PATHS}</symbol>
`;

/**
 * 搜索框 toggle 用内联 SVG。
 * 不走 use 引用插件 sprite，避免零尺寸 defs 导致图标被拉变形。
 */
export const SEARCH_TOGGLE_ICON_CASE = `<svg ${STROKE_ICON_ATTRS} aria-hidden="true">${CASE_SENSITIVE_PATHS}</svg>`;
export const SEARCH_TOGGLE_ICON_WHOLE = `<svg ${STROKE_ICON_ATTRS} aria-hidden="true">${WHOLE_WORD_PATHS}</svg>`;
