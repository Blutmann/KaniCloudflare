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
  _inputType: ModalOriginInputType = "pointer",
): ContainerTransformParams {
  if (!isValidRect(originRect) || !isValidRect(modalRect)) {
    return {
      dx: 0,
      dy: 0,
      enterScale: 0.9,
      exitScale: 0.9,
      insetX: 0,
      insetY: 0,
      originRadius: 22,
      hasOrigin: false,
    };
  }

  const originCenterX = originRect.left + originRect.width / 2;
  const originCenterY = originRect.top + originRect.height / 2;

  // Si el activador quedó fuera del viewport visible (por ej. tras hacer scroll),
  // aplicar transición centrada alternativa sin saltar a coordenadas fuera de pantalla.
  if (
    originCenterX < 0 ||
    originCenterX > viewport.width ||
    originCenterY < 0 ||
    originCenterY > viewport.height
  ) {
    return {
      dx: 0,
      dy: 0,
      enterScale: 0.9,
      exitScale: 0.9,
      insetX: 0,
      insetY: 0,
      originRadius: 22,
      hasOrigin: false,
    };
  }

  const modalCenterX = modalRect.left + modalRect.width / 2;
  const modalCenterY = modalRect.top + modalRect.height / 2;

  // Desplazamiento exacto entre el centro del botón activador y el centro del modal
  const dx = Math.round(originCenterX - modalCenterX);
  const dy = Math.round(originCenterY - modalCenterY);

  // Escala uniforme = 1 cuando el botón cabe dentro del modal (evita deformar
  // tipografías o inputs), reduciéndose solo si el botón excede al modal.
  const exactScale = Number(
    Math.min(1, modalRect.width / originRect.width, modalRect.height / originRect.height).toFixed(4),
  );

  // Recorte exacto en coordenadas locales del modal para que en t=0 (apertura)
  // y t=1 (cierre) la caja visual coincida 1:1 con originRect (width x height).
  const insetX = Number(Math.max(0, (modalRect.width - originRect.width / exactScale) / 2).toFixed(2));
  const insetY = Number(Math.max(0, (modalRect.height - originRect.height / exactScale) / 2).toFixed(2));

  return {
    dx,
    dy,
    enterScale: exactScale,
    exitScale: exactScale,
    insetX,
    insetY,
    originRadius: clamp(Math.round(originBorderRadius), 12, 32),
    hasOrigin: true,
  };
}
