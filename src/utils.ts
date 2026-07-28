export const CLASS_NAME = "jchs-container";

/** 判断是否为移动端 */
export const isMobile = () => {
    return !!(window as any).siyuan?.mobile;
};

/** 判断当前环境是否支持 CSS Custom Highlight API */
export const isHighlightApiSupported = () => {
    return typeof CSS !== "undefined"
        && "highlights" in CSS
        && typeof Highlight !== "undefined";
};
