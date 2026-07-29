/**
 * 对齐 VS Code `buildReplaceStringWithCasePreserved`：
 * 全大 / 全小 / 首字母微调；`-` / `_` 同段数时按段处理。
 * 不做驼峰分词映射。
 */
export function buildReplaceStringWithCasePreserved(
    match: string,
    pattern: string,
): string {
    if (!match) return pattern;

    const containsHyphens = validateSpecial(match, pattern, "-");
    const containsUnderscores = validateSpecial(match, pattern, "_");
    if (containsHyphens && !containsUnderscores) {
        return buildForSpecial(match, pattern, "-");
    }
    if (!containsHyphens && containsUnderscores) {
        return buildForSpecial(match, pattern, "_");
    }

    if (match.toUpperCase() === match) {
        return pattern.toUpperCase();
    }
    if (match.toLowerCase() === match) {
        return pattern.toLowerCase();
    }
    if (pattern.length === 0) {
        return pattern;
    }
    const first = match[0];
    if (containsUppercaseCharacter(first)) {
        return pattern[0].toUpperCase() + pattern.slice(1);
    }
    if (first.toUpperCase() !== first) {
        return pattern[0].toLowerCase() + pattern.slice(1);
    }
    return pattern;
}

function validateSpecial(match: string, pattern: string, ch: string): boolean {
    if (!match.includes(ch) || !pattern.includes(ch)) return false;
    return match.split(ch).length === pattern.split(ch).length;
}

function buildForSpecial(match: string, pattern: string, ch: string): string {
    const matchParts = match.split(ch);
    const patternParts = pattern.split(ch);
    const parts: string[] = [];
    for (let i = 0; i < patternParts.length; i++) {
        parts.push(
            buildReplaceStringWithCasePreserved(matchParts[i] ?? "", patternParts[i]),
        );
    }
    return parts.join(ch);
}

/** 单字符是否含大写（对齐 VS Code containsUppercaseCharacter 的单字符用法） */
function containsUppercaseCharacter(ch: string): boolean {
    if (!ch) return false;
    return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}
