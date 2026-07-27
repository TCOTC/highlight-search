/** 搜索框全局拖拽控制器 */
export class DragController {
    private isDragging = false;
    private dragStartX = 0;
    private dragStartY = 0;
    private initialLeft = 0;
    private initialTop = 0;
    private currentDraggingElement: HTMLElement | null = null;

    setupListeners() {
        document.addEventListener("mousemove", this.handleMouseMove);
        document.addEventListener("mouseup", this.handleMouseUp);
    }

    removeListeners() {
        document.removeEventListener("mousemove", this.handleMouseMove);
        document.removeEventListener("mouseup", this.handleMouseUp);
        this.isDragging = false;
        this.currentDraggingElement = null;
    }

    startDragging(element: HTMLElement, startX: number, startY: number) {
        this.isDragging = true;
        this.dragStartX = startX;
        this.dragStartY = startY;
        this.currentDraggingElement = element;

        const rect = element.getBoundingClientRect();
        this.initialLeft = rect.left;
        this.initialTop = rect.top;
    }

    /** 清除定位样式，让组件回到默认位置 */
    resetPosition(element: HTMLElement) {
        element.style.position = "";
        element.style.left = "";
        element.style.top = "";
        element.style.zIndex = "";
    }

    private handleMouseMove = (event: MouseEvent) => {
        if (!this.isDragging || !this.currentDraggingElement) return;

        const deltaX = event.clientX - this.dragStartX;
        const deltaY = event.clientY - this.dragStartY;

        this.currentDraggingElement.style.position = "fixed";
        this.currentDraggingElement.style.left = `${this.initialLeft + deltaX}px`;
        this.currentDraggingElement.style.top = `${this.initialTop + deltaY}px`;
        this.currentDraggingElement.style.zIndex = "9999";
    };

    private handleMouseUp = () => {
        this.isDragging = false;
        this.currentDraggingElement = null;
    };
}
