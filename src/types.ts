/** 事件总线回调 */
export type EventBusCallback = (event: CustomEvent) => void;

/** SearchBox 依赖的宿主能力 */
export interface SearchHost {
    onSearchComponentMounted(callback: EventBusCallback): void;
    onSearchComponentUnmounted(callback?: EventBusCallback): void;
    updateLastHighlightComponent(element: Element): void;
    isLastHighlightComponent(element: Element): boolean;
    startDragging(element: HTMLElement, startX: number, startY: number): void;
    closeCurrentSearchDialog(element: Element): void;
}

/** 思源插件事件总线的最小接口 */
export interface EventBusLike {
    on(event: string, callback: EventBusCallback): void;
    off(event: string, callback: EventBusCallback): void;
}
