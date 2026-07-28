/** 事件总线回调 */
export type EventBusCallback = (event: CustomEvent) => void;

/** SearchBox 依赖的宿主能力 */
export interface SearchHost {
    closeCurrentSearchDialog(element: Element): void;
}

/** 思源插件事件总线的最小接口 */
export interface EventBusLike {
    on(event: string, callback: EventBusCallback): void;
    off(event: string, callback: EventBusCallback): void;
}
