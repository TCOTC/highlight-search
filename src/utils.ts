export const CLASS_NAME = "jchs-container";

/** 判断是否为移动端 */
export const isMobile = () => {
    return !!(window as any).siyuan?.mobile;
};
