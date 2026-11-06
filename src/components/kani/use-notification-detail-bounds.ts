import { useEffect } from 'react';

export function useNotificationDetailBounds(panel: HTMLDivElement | null, open: boolean) {
  useEffect(() => {
    if (!open || !panel) return;
    const mobile = window.matchMedia('(max-width: 767px)');
    const viewport = window.visualViewport;
    const header = document.querySelector('header.site-header');
    const bars = [...document.querySelectorAll('.site-footer, .booking-cta, .mobile-menu-footer, [data-admin-bottom-actions]')];
    const continueButtons = [...document.querySelectorAll('.booking-cta button')];
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (!mobile.matches) {
        panel.style.removeProperty('--notification-detail-top');
        panel.style.removeProperty('--notification-detail-height');
        return;
      }
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const gap = parseFloat(getComputedStyle(panel).paddingLeft);
      const top = Math.max(viewportTop, header?.getBoundingClientRect().bottom ?? viewportTop) + gap;
      let bottom = viewportBottom;
      let bottomGap = gap;
      for (const bar of bars) {
        const rect = bar.getBoundingClientRect();
        if (getComputedStyle(bar).visibility !== 'hidden' && rect.width > 0 && rect.height > 0
          && rect.top > top && rect.top < bottom && rect.bottom >= viewportBottom - 1) bottom = rect.top;
      }
      const footer = bars.find(bar => {
        const rect = bar.getBoundingClientRect();
        return bar.matches('.site-footer') && rect.width > 0 && rect.height > 0
          && rect.top < viewportBottom && rect.bottom >= viewportBottom - 1;
      });
      const next = continueButtons.find(button => {
        const rect = button.getBoundingClientRect();
        return (button.textContent?.trim() === 'Continuar' || button.matches('.booking-next-button')) && rect.width > 0 && rect.height > 0
          && rect.top > top && getComputedStyle(button).visibility !== 'hidden';
      });
      if (footer && next) {
        const footerRect = footer.getBoundingClientRect(), buttonRect = next.getBoundingClientRect();
        if (buttonRect.bottom <= footerRect.top) {
          bottom = buttonRect.top;
          bottomGap = footerRect.top - buttonRect.bottom;
        }
      }
      panel.style.setProperty('--notification-detail-top', `${top}px`);
      panel.style.setProperty('--notification-detail-height', `${Math.max(0, bottom - bottomGap - top)}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    for (const element of [header, ...bars, ...continueButtons]) if (element) observer?.observe(element);
    measure();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    mobile.addEventListener('change', schedule);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      mobile.removeEventListener('change', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    };
  }, [panel, open]);
}
