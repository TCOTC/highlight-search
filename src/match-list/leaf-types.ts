/**
 * 含正文的叶子块 type（思源 blocks.type 缩写）。
 * 容器块（l/i/b/s/callout）不纳入，避免与子块重复计数。
 */
export const LEAF_CONTENT_BLOCK_TYPES = [
    "p", // 段落
    "h", // 标题
    "c", // 代码块
    "m", // 公式块
    "t", // 表格
    "html", // HTML 块
    "av", // 数据库
    "query_embed", // 嵌入块
] as const;
