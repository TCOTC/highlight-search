import { getSearchBox } from "./search-box";
import { CLASS_NAME } from "./utils";
import type { SearchHost } from "./types";

/** 管理搜索框关闭与插件卸载清理 */
export class SearchHostImpl implements SearchHost {
    closeCurrentSearchDialog(element: Element) {
        getSearchBox(element)?.destroy();
        element.remove();
    }

    dispose() {
        document.querySelectorAll(`.${CLASS_NAME}`).forEach((element) => {
            getSearchBox(element)?.destroy();
            element.remove();
        });
    }
}
