import { useEffect } from 'react';

/** Keep the content-sized dialog centered in the visible viewport, including keyboards. */
export function useNotificationDetailBounds(panel: HTMLDivElement | null, open: boolean) {
  useEffect(() => {
    if (!open || !panel) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const measure = () => {
      frame = 0;
      panel.style.setProperty('--notification-detail-viewport-top', `${viewport?.offsetTop ?? 0}px`);
      panel.style.setProperty('--notification-detail-viewport-left', `${viewport?.offsetLeft ?? 0}px`);
      panel.style.setProperty('--notification-detail-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
      panel.style.setProperty('--notification-detail-viewport-width', `${viewport?.width ?? window.innerWidth}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('resize', schedule);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      for (const dimension of ['top', 'left', 'height', 'width']) {
        panel.style.removeProperty(`--notification-detail-viewport-${dimension}`);
      }
    };
  }, [panel, open]);
}
