import { DragController } from "./drag";
import { CLASS_NAME, isMobile } from "./utils";
import type { EventBusCallback, EventBusLike, SearchHost } from "./types";

/** 可销毁的搜索框实例 */
export interface SearchBoxInstance {
    destroy(): void;
    setSearchText(text: string): void;
    focus(): void;
}

/** 管理搜索框实例、事件总线转发与高亮归属 */
export class SearchHostImpl implements SearchHost {
    private readonly callbacks = new Set<EventBusCallback>();
    private readonly instances = new Map<Element, SearchBoxInstance>();
    private lastHighlightComponent: Element | null = null;
    private cleanupTimer: number | null = null;

    constructor(
        private readonly eventBus: EventBusLike,
        private readonly drag: DragController,
    ) {}

    register(element: Element, instance: SearchBoxInstance) {
        this.instances.set(element, instance);
    }

    get(element: Element): SearchBoxInstance | undefined {
        return this.instances.get(element);
    }

    updateLastHighlightComponent(element: Element) {
        this.lastHighlightComponent = element;
    }

    isLastHighlightComponent(element: Element): boolean {
        return this.lastHighlightComponent === element;
    }

    startDragging(element: HTMLElement, startX: number, startY: number) {
        this.drag.startDragging(element, startX, startY);
    }

    onSearchComponentMounted(callback: EventBusCallback) {
        this.callbacks.add(callback);

        // 首个组件挂载时启用事件监听与定期清理
        if (this.callbacks.size === 1) {
            this.eventBusOn();
            if (!isMobile()) {
                this.drag.setupListeners();
            }
            this.startCleanupTimer();
        }
    }

    onSearchComponentUnmounted(callback?: EventBusCallback) {
        if (callback) {
            this.callbacks.delete(callback);
        }

        // 全部卸载后取消监听
        if (this.callbacks.size === 0) {
            this.eventBusOff();
            this.drag.removeListeners();
            this.stopCleanupTimer();
            this.lastHighlightComponent = null;
        }
    }

    closeSearchDialog() {
        const elements = [...this.instances.keys()];
        elements.forEach((element) => this.destroyInstance(element));

        document.querySelectorAll(`.${CLASS_NAME}`).forEach((element) => {
            try {
                element.remove();
            } catch (error) {
                console.error("Error removing DOM element:", error);
            }
        });
    }

    closeCurrentSearchDialog(element: Element) {
        this.destroyInstance(element);
        try {
            element.remove();
        } catch (error) {
            console.error("Error removing DOM element:", error);
        }
    }

    /** 清理已脱离 DOM 的无效实例 */
    cleanupInvalidComponents() {
        const invalidElements: Element[] = [];
        this.instances.forEach((_, element) => {
            if (!document.contains(element)) {
                invalidElements.push(element);
            }
        });

        if (invalidElements.length > 0) {
            console.warn("Component element detected as unexpectedly removed, cleaning up...");
        }

        invalidElements.forEach((element) => this.destroyInstance(element));
    }

    dispose() {
        this.closeSearchDialog();
        this.drag.removeListeners();
        this.stopCleanupTimer();
    }

    private destroyInstance(element: Element) {
        const instance = this.instances.get(element);
        if (!instance) return;

        try {
            instance.destroy();
        } catch (error) {
            console.error("Error destroying search instance:", error);
        }
        this.instances.delete(element);
    }

    private eventBusOn() {
        this.eventBus.on("ws-main", this.handleEventBusEvent);
        // 动态加载之后需要刷新搜索结果并高亮，但不要滚动
        this.eventBus.on("loaded-protyle-dynamic", this.handleEventBusEvent);
        // 浮窗查看上下文会重新加载编辑器，此时需要刷新搜索结果并高亮，但不要滚动
        this.eventBus.on("loaded-protyle-static", this.handleEventBusEvent);
        // 切换页签之后需要刷新搜索结果并高亮，但不要滚动
        this.eventBus.on("switch-protyle", this.handleEventBusEvent);
        // 切换编辑器模式之后需要刷新搜索结果并高亮，但不要滚动
        // https://github.com/siyuan-note/siyuan/issues/15516
        this.eventBus.on("switch-protyle-mode", this.handleEventBusEvent);
    }

    private eventBusOff() {
        this.eventBus.off("ws-main", this.handleEventBusEvent);
        this.eventBus.off("loaded-protyle-dynamic", this.handleEventBusEvent);
        this.eventBus.off("loaded-protyle-static", this.handleEventBusEvent);
        this.eventBus.off("switch-protyle", this.handleEventBusEvent);
        this.eventBus.off("switch-protyle-mode", this.handleEventBusEvent);
    }

    private handleEventBusEvent = (event: CustomEvent) => {
        this.callbacks.forEach((callback) => callback(event));
    };

    private startCleanupTimer() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        // 每 30 秒检查一次
        this.cleanupTimer = window.setInterval(() => {
            this.cleanupInvalidComponents();
        }, 30000);
    }

    private stopCleanupTimer() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
}
