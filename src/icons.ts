/** 插件自定义图标 ID（addIcons 注册） */
export const ICON_CASE_SENSITIVE = "iconJCHSCaseSensitive";
export const ICON_WHOLE_WORD = "iconJCHSWholeWord";
export const ICON_PRESERVE_CASE = "iconJCHSPreserveCase";

/** Lucide 描边属性（写在 symbol 内，避免被思源全局 svg { fill } 覆盖） */
const STROKE_ATTRS = `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`;

/** Lucide case-sensitive / whole-word / case-upper（24×24 描边图标） */
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

/** Lucide case-upper（来源 D:\\Admin\\Downloads\\case-upper.svg） */
const PRESERVE_CASE_PATHS = `
<path d="M15 11h4.5a1 1 0 0 1 0 5h-4a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h3a1 1 0 0 1 0 5"/>
<path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16"/>
<path d="M3.304 13h6.392"/>
`;

/** addIcons 注册用 symbol */
export const PLUGIN_ICON_SYMBOLS = `
<symbol id="${ICON_CASE_SENSITIVE}" viewBox="0 0 24 24"><g ${STROKE_ATTRS}>${CASE_SENSITIVE_PATHS}</g></symbol>
<symbol id="${ICON_WHOLE_WORD}" viewBox="0 0 24 24"><g ${STROKE_ATTRS}>${WHOLE_WORD_PATHS}</g></symbol>
<symbol id="${ICON_PRESERVE_CASE}" viewBox="0 0 24 24"><g ${STROKE_ATTRS}>${PRESERVE_CASE_PATHS}</g></symbol>
`;

/** 搜索框 toggle：与其它按钮一致，通过 use 引用 sprite */
export const SEARCH_TOGGLE_ICON_CASE = `<svg><use xlink:href="#${ICON_CASE_SENSITIVE}"/></svg>`;
export const SEARCH_TOGGLE_ICON_WHOLE = `<svg><use xlink:href="#${ICON_WHOLE_WORD}"/></svg>`;
export const SEARCH_TOGGLE_ICON_PRESERVE_CASE = `<svg><use xlink:href="#${ICON_PRESERVE_CASE}"/></svg>`;
