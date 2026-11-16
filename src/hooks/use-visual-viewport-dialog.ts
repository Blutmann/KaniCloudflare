import { useCallback, useEffect, useState } from "react";

/**
 * Syncs a mounted dialog element with `window.visualViewport` bounds
 * (`--kani-vv-top`, `--kani-vv-left`, `--kani-vv-height`, `--kani-vv-width`)
 * and keeps focused form fields scrolled into view inside the dialog's own
 * scroll container when a mobile virtual keyboard resizes the viewport.
 */
export function useVisualViewportDialog<T extends HTMLElement>(
  forwardedRef?: React.ForwardedRef<T>,
) {
  const [el, setEl] = useState<T | null>(null);

  const setRefs = useCallback(
    (node: T | null) => {
      setEl(node);
      if (typeof forwardedRef === "function") {
        forwardedRef(node);
      } else if (forwardedRef && typeof forwardedRef === "object") {
        (forwardedRef as React.MutableRefObject<T | null>).current = node;
      }
    },
    [forwardedRef],
  );

  useEffect(() => {
    if (!el || typeof window === "undefined") return;

    const vv = window.visualViewport;
    let frame = 0;

    const scrollFocusedFieldIntoView = () => {
      // Preserve /reservar Payway modal's own layout & scroll behavior.
      if (el.classList.contains("payway-checkout")) return;

      const active = document.activeElement;
      if (
        !(active instanceof HTMLElement) ||
        !el.contains(active) ||
        !active.matches("input, select, textarea")
      ) {
        return;
      }

      // Find the nearest scrollable container inside the dialog (or the dialog itself).
      let scrollParent: HTMLElement | null = active.parentElement;
      while (scrollParent && scrollParent !== el.parentElement) {
        const style = window.getComputedStyle(scrollParent);
        const overflowY = style.overflowY;
        if (
          (overflowY === "auto" || overflowY === "scroll") &&
          scrollParent.scrollHeight > scrollParent.clientHeight
        ) {
          break;
        }
        if (scrollParent === el) break;
        scrollParent = scrollParent.parentElement;
      }

      if (!scrollParent || scrollParent === el.parentElement) return;

      const itemRect = active.getBoundingClientRect();
      const areaRect = scrollParent.getBoundingClientRect();
      const margin = 12;

      if (itemRect.bottom > areaRect.bottom - margin) {
        scrollParent.scrollTop += itemRect.bottom - areaRect.bottom + margin;
      } else if (itemRect.top < areaRect.top + margin) {
        scrollParent.scrollTop -= areaRect.top - itemRect.top + margin;
      }
    };

    const measure = () => {
      frame = 0;
      const top = vv?.offsetTop ?? 0;
      const left = vv?.offsetLeft ?? 0;
      const height = vv?.height ?? window.innerHeight;
      const width = vv?.width ?? document.documentElement.clientWidth;

      el.style.setProperty("--kani-vv-top", `${top}px`);
      el.style.setProperty("--kani-vv-left", `${left}px`);
      el.style.setProperty("--kani-vv-height", `${height}px`);
      el.style.setProperty("--kani-vv-width", `${width}px`);

      scrollFocusedFieldIntoView();
    };

    const schedule = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(measure);
      }
    };

    measure();
    window.addEventListener("resize", schedule);
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    el.addEventListener("focusin", schedule);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      el.removeEventListener("focusin", schedule);
    };
  }, [el]);

  return setRefs;
}
