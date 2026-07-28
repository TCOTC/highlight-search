import { fetchSyncPost } from "siyuan";
import {
    findMatchSpans,
    makeSnippetFromSpan,
    normalizeSearchValue,
    resolveCaseSensitive,
    type CaseSensitiveMode,
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
    /** protyle.path，用于 FTS paths */
    path: string;
    query: string;
    caseMode: CaseSensitiveMode;
}

/** 转义 SQL 字符串字面量中的单引号 */
function escSql(value: string): string {
    return value.replace(/'/g, "''");
}

/** 转义 LIKE 通配符 */
function escLike(value: string): string {
    return value.replace(/([%_\\])/g, "\\$1");
}

const DOM_BATCH_SIZE = 64;
const DOM_BATCH_CONCURRENCY = 4;
/** SQL 粗筛显式 LIMIT，避免思源默认追加 64 条上限 */
const SQL_CANDIDATE_LIMIT = 100000;

/**
 * 批量 /api/block/getBlockDOMs → 可见文本。
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
        const body: Record<string, unknown> = { ids: batch };
        if (notebookId) {
            body.notebook = notebookId;
        }
        try {
            const response = await fetchSyncPost("/api/block/getBlockDOMs", body);
            if (response.code !== 0 || !response.data || typeof response.data !== "object") {
                for (const id of batch) {
                    if (!result.has(id)) result.set(id, "");
                }
                return;
            }
            const doms = response.data as Record<string, string>;
            for (const id of batch) {
                result.set(id, visibleTextFromBlockDom(doms[id] || ""));
            }
        } catch {
            // 单批失败则这批可见文本为空，后续会被过滤掉
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
 * 失败返回 null（调用方回退 FTS）。
 */
async function fetchCandidateIdsBySql(
    rootId: string,
    query: string,
    caseSensitive: boolean,
): Promise<string[] | null> {
    const needle = normalizeSearchValue(query);
    if (!needle) return [];

    let stmt: string;
    if (caseSensitive) {
        stmt =
            `SELECT id FROM blocks WHERE root_id = '${escSql(rootId)}' ` +
            `AND type != 'd' AND instr(content, '${escSql(needle)}') > 0 ` +
            `LIMIT ${SQL_CANDIDATE_LIMIT}`;
    } else {
        stmt =
            `SELECT id FROM blocks WHERE root_id = '${escSql(rootId)}' ` +
            `AND type != 'd' AND lower(content) LIKE '%${escLike(escSql(needle.toLowerCase()))}%' ESCAPE '\\' ` +
            `LIMIT ${SQL_CANDIDATE_LIMIT}`;
    }

    try {
        const response = await fetchSyncPost("/api/query/sql", { stmt, mode: "readonly" });
        if (response.code !== 0 || !Array.isArray(response.data)) {
            return null;
        }
        return (response.data as Array<{ id?: string }>)
            .map((row) => row.id)
            .filter((id): id is string => typeof id === "string" && !!id);
    } catch {
        return null;
    }
}

/**
 * FTS 粗筛候选块 ID。
 */
async function fetchCandidateIdsByFts(
    notebookId: string,
    path: string,
    query: string,
    rootId: string,
): Promise<string[]> {
    const needle = normalizeSearchValue(query);
    if (!needle) return [];

    const paths = [joinPath(notebookId, path)];
    const pageSize = 64;
    const results: string[] = [];
    const seen = new Set<string>();
    let page = 1;
    let pageCount = 1;

    while (page <= pageCount) {
        const response = await fetchSyncPost("/api/search/fullTextSearchBlock", {
            query: needle,
            method: 0,
            paths,
            page,
            pageSize,
            orderBy: 0,
            groupBy: 0,
        });
        if (response.code !== 0 || !response.data) break;

        const data = response.data as {
            blocks?: Array<{ id?: string; rootID?: string }>;
            pageCount?: number;
        };
        pageCount = typeof data.pageCount === "number" ? data.pageCount : page;
        for (const block of data.blocks || []) {
            if (!block.id || seen.has(block.id)) continue;
            if (block.rootID && block.rootID !== rootId) continue;
            seen.add(block.id);
            results.push(block.id);
        }
        page += 1;
        if (!data.blocks || data.blocks.length === 0) break;
    }

    return results;
}

function joinPath(notebookId: string, path: string): string {
    if (!path || path === "/") return notebookId;
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `${notebookId}${normalized}`;
}

/** 用 getBlocksIndexes 按文档阅读序排序 */
async function sortByDocOrder(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    if (ids.length === 1) return ids;

    try {
        const response = await fetchSyncPost("/api/block/getBlocksIndexes", { ids });
        if (response.code !== 0 || !response.data || typeof response.data !== "object") {
            return ids;
        }
        const indexMap = response.data as Record<string, number>;
        return [...ids].sort((a, b) => {
            const ia = indexMap[a] ?? Number.MAX_SAFE_INTEGER;
            const ib = indexMap[b] ?? Number.MAX_SAFE_INTEGER;
            return ia - ib;
        });
    } catch {
        return ids;
    }
}

/**
 * 建全文档 Match 列表：
 * 1. SQL/FTS 粗筛候选 ID（content 可能含链接 URL）
 * 2. getBlockDOMs 解析可见文本
 * 3. getBlocksIndexes 排文档序
 * 4. 在可见文本上展开 occ
 */
export async function buildMatchList(opts: BuildMatchListOptions): Promise<FindMatch[]> {
    const needle = normalizeSearchValue(opts.query);
    if (!needle || !opts.rootId) return [];

    const caseSensitive = resolveCaseSensitive(opts.caseMode);

    let candidateIds = await fetchCandidateIdsBySql(opts.rootId, needle, caseSensitive);
    if (candidateIds === null) {
        candidateIds = await fetchCandidateIdsByFts(
            opts.notebookId,
            opts.path,
            needle,
            opts.rootId,
        );
    }
    if (candidateIds.length === 0) return [];

    const visibleById = await fetchVisibleTextsByDom(candidateIds, opts.notebookId);

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

    const orderedIds = await sortByDocOrder(matchedIds);

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
