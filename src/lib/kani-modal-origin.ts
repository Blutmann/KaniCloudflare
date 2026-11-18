/**
 * KANI Motion System v1.1 — Origin-Based Modal Transition Tracker
 *
 * Captura el elemento activador (mouse, touch o teclado) para calcular el
 * desplazamiento FLIP relativo hacia la posición final centrada del modal,
 * sin modificar el `transform: translate3d(-50%, -50%, 0)` de centrado.
 */

export interface ModalOriginRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type ModalOriginInputType = "touch" | "pointer" | "keyboard";

interface CapturedOrigin {
  element: Element | null;
  rect: ModalOriginRect;
  timestamp: number;
  inputType: ModalOriginInputType;
}

const ORIGIN_MAX_AGE_MS = 900;
const TRIGGER_SELECTOR =
  'button, [role="button"], a[href], input[type="button"], input[type="submit"], [data-modal-trigger]';

let lastCapturedOrigin: CapturedOrigin | null = null;
let listenersInstalled = false;

function isValidRect(rect: DOMRect | ModalOriginRect | null | undefined): rect is ModalOriginRect {
  if (!rect) return false;
  return Number.isFinite(rect.left) && Number.isFinite(rect.top) && rect.width > 0 && rect.height > 0;
}

function applyTactileTriggerPulse(trigger: Element): void {
  if (!(trigger instanceof HTMLElement)) return;
  trigger.setAttribute("data-kani-trigger-pulse", "true");
  window.setTimeout(() => {
    if (trigger.isConnected) {
      trigger.removeAttribute("data-kani-trigger-pulse");
    }
  }, 110);
}

function recordOriginElement(
  target: EventTarget | null,
  inputType: ModalOriginInputType = "pointer",
): void {
  if (typeof window === "undefined" || !(target instanceof Element)) return;
  const trigger = target.closest(TRIGGER_SELECTOR) ?? target;
  // Ignorar clics dentro de un diálogo ya abierto (para no confundir acciones internas con apertura)
  if (trigger.closest('[data-slot="dialog-content"]')) return;
  const rect = trigger.getBoundingClientRect();
  if (!isValidRect(rect)) return;
  applyTactileTriggerPulse(trigger);
  lastCapturedOrigin = {
    element: trigger,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    timestamp: Date.now(),
    inputType,
  };
}

export function installModalOriginListeners(): void {
  if (listenersInstalled || typeof document === "undefined") return;
  listenersInstalled = true;

  const handlePointerDown = (event: Event) => {
    const pointerType =
      typeof PointerEvent !== "undefined" && event instanceof PointerEvent
        ? event.pointerType
        : "mouse";
    recordOriginElement(event.target, pointerType === "touch" ? "touch" : "pointer");
  };

  const handleClick = (event: Event) => {
    const pointerEvent = event as MouseEvent;
    // detail === 0 suele indicar activación por teclado (Enter/Space) en botones nativos
    const inputType: ModalOriginInputType =
      pointerEvent.detail === 0 ? "keyboard" : lastCapturedOrigin?.inputType ?? "pointer";
    recordOriginElement(event.target, inputType);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      recordOriginElement(event.target ?? document.activeElement, "keyboard");
    }
  };

  document.addEventListener("pointerdown", handlePointerDown, { capture: true, passive: true });
  document.addEventListener("click", handleClick, { capture: true, passive: true });
  document.addEventListener("keydown", handleKeyDown, { capture: true, passive: true });
}

export function captureModalOriginElement(
  element: Element | null,
  inputType: ModalOriginInputType = "pointer",
): void {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  if (!isValidRect(rect)) return;
  lastCapturedOrigin = {
    element,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    timestamp: Date.now(),
    inputType,
  };
}

export function resetModalOriginForTests(): void {
  lastCapturedOrigin = null;
}

export function resolveActiveOrigin(): {
  element: Element | null;
  rect: ModalOriginRect;
  inputType: ModalOriginInputType;
} | null {
  if (typeof window === "undefined") return null;
  const now = Date.now();
  if (lastCapturedOrigin && now - lastCapturedOrigin.timestamp <= ORIGIN_MAX_AGE_MS) {
    if (lastCapturedOrigin.element?.isConnected) {
      const liveRect = lastCapturedOrigin.element.getBoundingClientRect();
      if (isValidRect(liveRect)) {
        return {
          element: lastCapturedOrigin.element,
          rect: { left: liveRect.left, top: liveRect.top, width: liveRect.width, height: liveRect.height },
          inputType: lastCapturedOrigin.inputType,
        };
      }
    }
    return {
      element: null,
      rect: lastCapturedOrigin.rect,
      inputType: lastCapturedOrigin.inputType,
    };
  }

  const active = document.activeElement;
  if (
    active &&
    active !== document.body &&
    active !== document.documentElement &&
    !active.closest('[data-slot="dialog-content"]')
  ) {
    const rect = active.getBoundingClientRect();
    if (isValidRect(rect)) {
      return {
        element: active,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        inputType: "keyboard",
      };
    }
  }

  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function computeOriginTransformOffsets(
  originRect: ModalOriginRect | null,
  modalRect: ModalOriginRect,
  viewport: { width: number; height: number } = {
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  },
): { dx: number; dy: number; enterScale: number; exitScale: number; hasOrigin: boolean } {
  if (!originRect || !isValidRect(originRect) || !isValidRect(modalRect)) {
    return { dx: 0, dy: 0, enterScale: 0.92, exitScale: 0.94, hasOrigin: false };
  }

  const originCenterX = originRect.left + originRect.width / 2;
  const originCenterY = originRect.top + originRect.height / 2;

  // Descartar orígenes fuera del viewport visible (ej. botón que scrolleó fuera)
  if (
    originCenterX < -40 ||
    originCenterX > viewport.width + 40 ||
    originCenterY < -40 ||
    originCenterY > viewport.height + 40
  ) {
    return { dx: 0, dy: 0, enterScale: 0.92, exitScale: 0.94, hasOrigin: false };
  }

  const modalCenterX = modalRect.left + modalRect.width / 2;
  const modalCenterY = modalRect.top + modalRect.height / 2;

  const maxDx = Math.max(120, viewport.width * 0.42);
  const maxDy = Math.max(140, viewport.height * 0.42);
  const dx = clamp(Math.round(originCenterX - modalCenterX), -maxDx, maxDx);
  const dy = clamp(Math.round(originCenterY - modalCenterY), -maxDy, maxDy);

  const ratioW = originRect.width / Math.max(modalRect.width, 1);
  const ratioH = originRect.height / Math.max(modalRect.height, 1);
  const enterScale = Number(clamp(Math.max(ratioW, ratioH) * 0.95, 0.82, 0.92).toFixed(3));
  const exitScale = Number(clamp(enterScale + 0.03, 0.85, 0.95).toFixed(3));

  return { dx, dy, enterScale, exitScale, hasOrigin: true };
}
