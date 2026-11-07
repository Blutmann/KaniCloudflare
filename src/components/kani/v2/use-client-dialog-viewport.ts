import { useEffect, useState, type CSSProperties } from "react";

// Fixed dialogs must follow the visual viewport when a mobile keyboard pans or resizes it.
// Radix continues to own focus trapping, Escape, and page scroll locking.
export function useClientDialogViewport(open: boolean): CSSProperties {
  const [bounds, setBounds] = useState<CSSProperties>({});
  useEffect(() => {
    if (!open) {
      setBounds({});
      return;
    }
    const viewport = window.visualViewport;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setBounds({
        "--client-dialog-viewport-top": `${viewport?.offsetTop ?? 0}px`,
        "--client-dialog-viewport-left": `${viewport?.offsetLeft ?? 0}px`,
        "--client-dialog-viewport-height": `${viewport?.height ?? window.innerHeight}px`,
        "--client-dialog-viewport-width": `${viewport?.width ?? document.documentElement.clientWidth}px`,
      } as CSSProperties);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const field = document.activeElement;
    if (
      !(field instanceof HTMLElement) ||
      !field.matches("input, textarea") ||
      !field.closest(".v2-client-editor")
    )
      return;
    const scroll = field.closest<HTMLElement>(".v2-client-modal-scroll");
    if (!scroll) return;
    const item = field.getBoundingClientRect(),
      area = scroll.getBoundingClientRect();
    // Keep the focused field visible after keyboard resize without scrolling the page behind Radix.
    if (item.bottom > area.bottom - 8) scroll.scrollTop += item.bottom - area.bottom + 8;
    else if (item.top < area.top + 8) scroll.scrollTop -= area.top - item.top + 8;
  }, [bounds, open]);
  return bounds;
}
