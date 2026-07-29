import type { FindMatch } from "../find-match";
import type { DomHit } from "./dom-hits";
import { getDomHits } from "./css-highlight";

/**
 * 在当前 DOM 命中中查找与 FindMatch 对齐的项。
 * 1) 精确 occ 且 Range 文本与 snippet 命中一致（若有）
 * 2) 按 snippet 命中文本对齐 Range（避免 occ 回退指错元素）
 * 3) 最后才按 occ 距离回退
 */
export function resolveDomHit(source: object, match: FindMatch): DomHit | undefined {
    const hits = getDomHits(source);
    const sameBlock = hits.filter((h) => h.blockId === match.blockId);
    if (sameBlock.length === 0) return undefined;

    const firstSpan = match.snippetMatches?.[0];
    const needle =
        match.snippet && firstSpan
            ? match.snippet.slice(firstSpan.start, firstSpan.end)
            : "";

    const rangeText = (h: DomHit) => h.range.toString();
    const textMatchesNeedle = (h: DomHit) => {
        if (!needle) return true;
        const t = rangeText(h);
        return t === needle || t.includes(needle) || needle.includes(t);
    };

    const exactOcc = sameBlock.find((h) => h.occ === match.occ);
    if (exactOcc && textMatchesNeedle(exactOcc)) {
        return exactOcc;
    }

    if (needle) {
        const exactText = sameBlock.filter((h) => rangeText(h) === needle);
        if (exactText.length === 1) return exactText[0];
        if (exactText.length > 1) {
            return (
                exactText.find((h) => h.occ === match.occ) ??
                exactText[0]
            );
        }
        const partial = sameBlock.filter(textMatchesNeedle);
        if (partial.length === 1) return partial[0];
        if (partial.length > 1) {
            return (
                partial.find((h) => h.occ === match.occ) ??
                partial.reduce((best, h) =>
                    Math.abs(h.occ - match.occ) < Math.abs(best.occ - match.occ) ? h : best,
                )
            );
        }
    }

    return sameBlock.reduce((best, h) =>
        Math.abs(h.occ - match.occ) < Math.abs(best.occ - match.occ) ? h : best,
    );
}
