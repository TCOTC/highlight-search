import { fetchSyncPost } from "siyuan";
import {
    findMatchSpans,
    makeSnippetFromSpan,
    normalizeSearchValue,
    type TextSpan,
} from "./match-text";
import { visibleTextFromBlockDom } from "./visible-text";

export { visibleTextFromBlockDom } from "./visible-text";

/** 文档内一处匹配（跨卸载仍稳定） */
export interface FindMatch {
    blockId: string;
    /** 该块内第几次出现（0-based） */
    occ: number;
    snippet?: string;
}

export interface BuildMatchListOptions {
    rootId: string;
    notebookId: string;
    query: string;
    caseSensitive: boolean;
}

/** 转义 SQL 字符串字面量中的单引号 */
function escSql(value: string): string {
    return value.replace(/'/g, "''");
}

const DOM_BATCH_SIZE = 64;
const DOM_BATCH_CONCURRENCY = 4;
/** SQL 粗筛显式 LIMIT，避免思源默认追加 64 条上限 */
const SQL_CANDIDATE_LIMIT = 100000;
/**
 * 含正文的叶子块 type（思源 blocks.type 缩写）。
 * 容器块（l/i/b/s/callout）不纳入，避免与子块重复计数。
 */
const LEAF_CONTENT_BLOCK_TYPES = [
    "p", // 段落
    "h", // 标题
    "c", // 代码块
    "m", // 公式块
    "t", // 表格
    "html", // HTML 块
    "av", // 数据库
    "query_embed", // 嵌入块
] as const;

async function fetchBlockDoms(
    batch: string[],
    notebookId: string,
): Promise<Record<string, string>> {
    const body: Record<string, unknown> = { ids: batch };
    if (notebookId) {
        body.notebook = notebookId;
    }

    try {
        const response = await fetchSyncPost("/api/block/getBlockDOMsWithEmbed", body);
        if (response.code === 0 && response.data && typeof response.data === "object") {
            return response.data as Record<string, string>;
        }
    } catch {
        // 回退到 getBlockDOMs
    }

    try {
        const response = await fetchSyncPost("/api/block/getBlockDOMs", body);
        if (response.code === 0 && response.data && typeof response.data === "object") {
            return response.data as Record<string, string>;
        }
    } catch {
        // 单批失败由调用方填空串
    }
    return {};
}

/**
 * 批量 getBlockDOMs(WithEmbed) → 离屏渲染 → 可见文本。
 * 加密笔记本需传 notebook。
 */
async function fetchVisibleTextsByDom(
    ids: string[],
    notebookId: string,
): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (ids.length === 0) return result;

    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += DOM_BATCH_SIZE) {
        batches.push(ids.slice(i, i + DOM_BATCH_SIZE));
    }

    async function processBatch(batch: string[]): Promise<void> {
        try {
            const doms = await fetchBlockDoms(batch, notebookId);
            await Promise.all(
                batch.map(async (id) => {
                    result.set(id, await visibleTextFromBlockDom(doms[id] || ""));
                }),
            );
        } catch {
            for (const id of batch) {
                if (!result.has(id)) result.set(id, "");
            }
        }
    }

    for (let i = 0; i < batches.length; i += DOM_BATCH_CONCURRENCY) {
        const chunk = batches.slice(i, i + DOM_BATCH_CONCURRENCY);
        await Promise.all(chunk.map((batch) => processBatch(batch)));
    }
    return result;
}

/**
 * SQL 粗筛候选块 ID（content 含 URL，仅用于捞候选，不算 occ）。
 * 失败返回空数组。
 */
async function fetchCandidateIdsBySql(
    rootId: string,
    query: string,
    caseSensitive: boolean,
): Promise<string[]> {
    const needle = normalizeSearchValue(query);
    if (!needle) return [];

    // 用 instr 做子串匹配，避免 LIKE ... ESCAPE 触发思源 /api/query/sql 的 rqlite 序列化 panic
    // https://github.com/siyuan-note/siyuan/issues/18413
    const haystack = caseSensitive ? "content" : "lower(content)";
    const needleLit = caseSensitive ? needle : needle.toLowerCase();
    const includeTypes = LEAF_CONTENT_BLOCK_TYPES.map((t) => `'${t}'`).join(", ");
    const stmt =
        `SELECT id FROM blocks WHERE root_id = '${escSql(rootId)}' ` +
        `AND type IN (${includeTypes}) ` +
        `AND instr(${haystack}, '${escSql(needleLit)}') > 0 ` +
        `LIMIT ${SQL_CANDIDATE_LIMIT}`;

    try {
        const response = await fetchSyncPost("/api/query/sql", { stmt, mode: "readonly" });
        if (response.code !== 0 || !Array.isArray(response.data)) {
            return [];
        }
        return (response.data as Array<{ id?: string }>)
            .map((row) => row.id)
            .filter((id): id is string => typeof id === "string" && !!id);
    } catch {
        return [];
    }
}

/**
 * 拉取文档内全部块的深度优先原文序。
 * 失败返回空数组。
 */
async function fetchDocBlocksOrders(rootId: string): Promise<string[]> {
    if (!rootId) return [];
    try {
        const response = await fetchSyncPost("/api/block/getDocBlocksOrders", { id: rootId });
        if (response.code !== 0 || !Array.isArray(response.data)) {
            return [];
        }
        return response.data as string[];
    } catch {
        return [];
    }
}

/**
 * 按文档阅读序排列候选 ID。
 * 单次扫描 docOrder（O(N)），避免对子集再 sort。
 */
function orderIdsByDocOrder(ids: string[], docOrder: string[]): string[] {
    if (ids.length <= 1 || docOrder.length === 0) return ids;

    const needed = new Set(ids);
    const ordered: string[] = [];
    for (const id of docOrder) {
        if (!needed.has(id)) continue;
        ordered.push(id);
        needed.delete(id);
        if (needed.size === 0) break;
    }
    if (needed.size > 0) {
        for (const id of ids) {
            if (needed.has(id)) ordered.push(id);
        }
    }
    return ordered;
}

/**
 * 建全文档 Match 列表（插件 DOM 流水线）。
 */
export async function buildMatchList(opts: BuildMatchListOptions): Promise<FindMatch[]> {
    return buildMatchListViaDom(opts);
}

/**
 * 插件 DOM 流水线：
 * 1. SQL 粗筛候选 ID（content 可能含链接 URL）
 * 2. getBlockDOMs(WithEmbed) 离屏渲染后解析可见文本（与 getDocBlocksOrders 并行）
 * 3. 按文档阅读序排列命中块
 * 4. 在可见文本上展开 occ
 */
async function buildMatchListViaDom(opts: BuildMatchListOptions): Promise<FindMatch[]> {
    const needle = normalizeSearchValue(opts.query);
    if (!needle || !opts.rootId) return [];

    const { caseSensitive } = opts;

    const candidateIds = await fetchCandidateIdsBySql(opts.rootId, needle, caseSensitive);
    if (candidateIds.length === 0) return [];

    // 文档序只依赖 rootId，与 DOM 可见文本拉取并行，隐藏一次 API 往返
    const [visibleById, docOrder] = await Promise.all([
        fetchVisibleTextsByDom(candidateIds, opts.notebookId),
        fetchDocBlocksOrders(opts.rootId),
    ]);

    const spansById = new Map<string, TextSpan[]>();
    const matchedIds: string[] = [];
    for (const id of candidateIds) {
        const text = visibleById.get(id) || "";
        const spans = findMatchSpans(text, needle, caseSensitive);
        if (spans.length > 0) {
            spansById.set(id, spans);
            matchedIds.push(id);
        }
    }
    if (matchedIds.length === 0) return [];

    const orderedIds = orderIdsByDocOrder(matchedIds, docOrder);

    const matches: FindMatch[] = [];
    for (const id of orderedIds) {
        const text = visibleById.get(id) || "";
        const spans = spansById.get(id) || [];
        for (let occ = 0; occ < spans.length; occ++) {
            matches.push({
                blockId: id,
                occ,
                snippet: makeSnippetFromSpan(text, spans[occ]),
            });
        }
    }
    return matches;
}
