import { fetchSyncPost } from "siyuan";
import { normalizeSearchValue } from "../match-text";
import { LEAF_CONTENT_BLOCK_TYPES } from "./leaf-types";

/** SQL 粗筛显式 LIMIT，避免思源默认追加 64 条上限 */
const SQL_CANDIDATE_LIMIT = 100000;

/** 转义 SQL 字符串字面量中的单引号 */
function escSql(value: string): string {
    return value.replace(/'/g, "''");
}

/**
 * SQL 粗筛候选块 ID（content 含 URL，仅用于捞候选，不算 occ）。
 * 失败返回空数组。
 */
export async function fetchCandidateIdsBySql(
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
