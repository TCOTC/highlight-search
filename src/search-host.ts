import { DragController } from "./drag";
import { getSearchBox } from "./search-box";
import { CLASS_NAME, isMobile } from "./utils";
import type { SearchHost } from "./types";

/** 管理拖拽与搜索框关闭 */
export class SearchHostImpl implements SearchHost {
    private mountCount = 0;

    constructor(private readonly drag: DragController) {}

    startDragging(element: HTMLElement, startX: number, startY: number) {
        this.drag.startDragging(element, startX, startY);
    }

    onSearchComponentMounted() {
        this.mountCount++;
        // 首个组件挂载时启用拖拽监听
        if (this.mountCount === 1 && !isMobile()) {
            this.drag.setupListeners();
        }
    }

    onSearchComponentUnmounted() {
        this.mountCount = Math.max(0, this.mountCount - 1);
        // 全部卸载后取消监听
        if (this.mountCount === 0) {
            this.drag.removeListeners();
        }
    }

    closeCurrentSearchDialog(element: Element) {
        getSearchBox(element)?.destroy();
        element.remove();
    }

    dispose() {
        document.querySelectorAll(`.${CLASS_NAME}`).forEach((element) => {
            getSearchBox(element)?.destroy();
            element.remove();
        });
        this.drag.removeListeners();
    }
}
