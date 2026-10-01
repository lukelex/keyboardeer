import type { Action } from "svelte/action";

/**
 * Lets a vertical mouse wheel scroll a horizontal strip while `enabled`.
 * The listener is non-passive because it cancels the vertical scroll.
 */
export const horizontalWheel: Action<HTMLElement, boolean> = (
  node,
  enabled,
) => {
  let active = enabled ?? false;
  const handleWheel = (event: WheelEvent) => {
    if (!active || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    if (node.scrollWidth <= node.clientWidth) return;
    event.preventDefault();
    node.scrollLeft += event.deltaY;
  };
  node.addEventListener("wheel", handleWheel, { passive: false });
  return {
    update: (next) => {
      active = next ?? false;
    },
    destroy: () => node.removeEventListener("wheel", handleWheel),
  };
};
