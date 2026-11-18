import type { ModalOriginInputType, ModalOriginRect } from "@/lib/kani-modal-origin";

export interface ContainerTransformParams {
  dx: number;
  dy: number;
  enterScale: number;
  exitScale: number;
  insetX: number;
  insetY: number;
  originRadius: number;
  hasOrigin: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isValidRect(rect: ModalOriginRect | null | undefined): rect is ModalOriginRect {
  if (!rect) return false;
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

export function parseOriginBorderRadius(element: Element | null): number {
  if (!element || typeof window === "undefined") return 20;
  try {
    const raw = window.getComputedStyle(element).borderRadius;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 16;
    return clamp(Math.round(parsed), 12, 32);
  } catch {
    return 20;
  }
}

export function computeContainerTransformParams(
  originRect: ModalOriginRect | null,
  modalRect: ModalOriginRect,
  viewport: { width: number; height: number } = {
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  },
  originBorderRadius = 20,
  inputType: ModalOriginInputType = "pointer",
): ContainerTransformParams {
  if (!isValidRect(originRect) || !isValidRect(modalRect)) {
    return {
      dx: 0,
      dy: 0,
      enterScale: 0.88,
      exitScale: 0.9,
      insetX: 0,
      insetY: 0,
      originRadius: 24,
      hasOrigin: false,
    };
  }

  const originCenterX = originRect.left + originRect.width / 2;
  const originCenterY = originRect.top + originRect.height / 2;

  if (
    originCenterX < -40 ||
    originCenterX > viewport.width + 40 ||
    originCenterY < -40 ||
    originCenterY > viewport.height + 40
  ) {
    return {
      dx: 0,
      dy: 0,
      enterScale: 0.88,
      exitScale: 0.9,
      insetX: 0,
      insetY: 0,
      originRadius: 24,
      hasOrigin: false,
    };
  }

  const modalCenterX = modalRect.left + modalRect.width / 2;
  const modalCenterY = modalRect.top + modalRect.height / 2;

  // Contextual Motion (Apple HIG): interacción táctil / viewport compacto enfatiza
  // continuidad espacial; puntero/teclado en desktop prioriza precisión y rapidez.
  const isTouchOrCompact = inputType === "touch" || viewport.width < 640;
  const travelRatio = isTouchOrCompact ? 0.5 : 0.48;
  const maxDx = Math.max(150, Math.round(viewport.width * travelRatio));
  const maxDy = Math.max(160, Math.round(viewport.height * travelRatio));
  const dx = clamp(Math.round(originCenterX - modalCenterX), -maxDx, maxDx);
  const dy = clamp(Math.round(originCenterY - modalCenterY), -maxDy, maxDy);

  const ratioW = originRect.width / Math.max(modalRect.width, 1);
  const ratioH = originRect.height / Math.max(modalRect.height, 1);
  const minScale = isTouchOrCompact ? 0.36 : 0.48;
  const maxScale = isTouchOrCompact ? 0.58 : 0.66;
  const enterScale = Number(clamp(Math.max(ratioW, ratioH) * 1.15, minScale, maxScale).toFixed(3));
  const exitScale = Number(clamp(enterScale + 0.04, minScale + 0.04, maxScale + 0.06).toFixed(3));

  // Calcular recorte inicial (clip-path inset) para transformar la proporción
  // del botón hacia la geometría del modal sin deformar tipografías ni inputs.
  const targetVisualW = clamp(
    Math.max(originRect.width, modalRect.width * 0.28),
    originRect.width,
    modalRect.width * enterScale,
  );
  const targetVisualH = clamp(
    Math.max(originRect.height * 1.35, modalRect.height * 0.16),
    originRect.height,
    modalRect.height * enterScale,
  );

  const insetX = Math.round(
    clamp((modalRect.width - targetVisualW / enterScale) / 2, 0, modalRect.width * 0.36),
  );
  const insetY = Math.round(
    clamp((modalRect.height - targetVisualH / enterScale) / 2, 0, modalRect.height * 0.4),
  );

  return {
    dx,
    dy,
    enterScale,
    exitScale,
    insetX,
    insetY,
    originRadius: clamp(Math.round(originBorderRadius), 12, 32),
    hasOrigin: true,
  };
}
