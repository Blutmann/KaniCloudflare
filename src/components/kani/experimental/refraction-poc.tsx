import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { useReducedMotion } from 'motion/react';

type PocMode = 'refraction' | 'blur-only';

/**
 * Prototipo aislado de Refracción Óptica Real (POC V11).
 * Accesible exclusivamente vía /reservar-turno-liquid?refraction-poc=1.
 * No interactúa con reservas, Supabase, disponibilidad ni Payway.
 */
export function RefractionPoc() {
  const shouldReduceMotion = useReducedMotion();
  const rawId = useId().replace(/:/g, '');
  const filterId = `kani-refraction-filter-${rawId}`;

  const [mode, setMode] = useState<PocMode>('refraction');
  const [lastOrigin, setLastOrigin] = useState<{ x: number; y: number } | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const feImageRef = useRef<SVGFEImageElement | null>(null);
  const feDispRef = useRef<SVGFEDisplacementMapElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const renderDisplacementFrame = (
    width: number,
    height: number,
    cx: number,
    cy: number,
    progress: number,
  ) => {
    if (typeof document === 'undefined') return;
    const scale = 0.5;
    const cw = Math.max(64, Math.round(width * scale));
    const ch = Math.max(32, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = ctx.createImageData(cw, ch);
    const data = img.data;
    const px = cx * scale;
    const py = cy * scale;
    const maxR = Math.hypot(Math.max(px, cw - px), Math.max(py, ch - py));
    const radius = progress * maxR * 1.15;
    const bandWidth = Math.max(14, maxR * 0.24);
    const fade = Math.sin(Math.min(1, progress) * Math.PI);

    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const dx = x - px;
        const dy = y - py;
        const dist = Math.hypot(dx, dy);
        const delta = Math.abs(dist - radius);
        const idx = (y * cw + x) * 4;

        if (delta < bandWidth && dist > 0.5) {
          const wave = Math.cos((delta / bandWidth) * (Math.PI / 2)) * fade;
          const nx = dx / dist;
          const ny = dy / dist;
          data[idx] = Math.max(0, Math.min(255, Math.round(128 + nx * wave * 120)));
          data[idx + 1] = Math.max(0, Math.min(255, Math.round(128 + ny * wave * 120)));
          data[idx + 2] = 128;
          data[idx + 3] = 255;
        } else {
          data[idx] = 128;
          data[idx + 1] = 128;
          data[idx + 2] = 128;
          data[idx + 3] = 255;
        }
      }
    }

    ctx.putImageData(img, 0, 0);
    const uri = canvas.toDataURL('image/png');
    feImageRef.current?.setAttribute('href', uri);
    feDispRef.current?.setAttribute('scale', mode === 'refraction' ? String(Math.round(30 * fade)) : '0');
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const y = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    setLastOrigin({ x: Math.round(x), y: Math.round(y) });

    if (shouldReduceMotion || mode === 'blur-only') return;

    if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafRef.current);
    }

    setIsAnimating(true);
    const start = performance.now();
    const duration = 640;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      renderDisplacementFrame(rect.width, rect.height, x, y, progress);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        feDispRef.current?.setAttribute('scale', '0');
        setIsAnimating(false);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  };

  return (
    <section className="lg-refraction-poc" aria-label="Prototipo aislado de refracción óptica real">
      <div className="lg-refraction-poc-header">
        <p className="lg-refraction-poc-kicker">POC AISLADO · REAL OPTICAL REFRACTION V11</p>
        <h1>Refracción espacial vs. Desenfoque</h1>
        <p className="lg-refraction-poc-desc">
          Tocá la card para generar una onda de desplazamiento espacial mediante{' '}
          <code>&lt;feDisplacementMap&gt;</code> sobre el patrón subyacente sin distorsionar la tipografía.
        </p>
        <div className="lg-refraction-poc-controls" role="group" aria-label="Modo de óptica">
          <button
            type="button"
            className={mode === 'refraction' ? 'is-active' : undefined}
            aria-pressed={mode === 'refraction'}
            onClick={() => setMode('refraction')}
          >
            B · Refracción SVG real
          </button>
          <button
            type="button"
            className={mode === 'blur-only' ? 'is-active' : undefined}
            aria-pressed={mode === 'blur-only'}
            onClick={() => setMode('blur-only')}
          >
            A · Solo desenfoque
          </button>
        </div>
      </div>

      <div className="lg-refraction-poc-stage">
        <svg className="lg-refraction-poc-svg" width="0" height="0" aria-hidden="true">
          <defs>
            <filter id={filterId} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
              <feImage ref={feImageRef} result="dispMap" preserveAspectRatio="none" />
              <feDisplacementMap
                ref={feDispRef}
                in="SourceGraphic"
                in2="dispMap"
                scale="0"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
        </svg>

        <div
          ref={cardRef}
          role="button"
          tabIndex={0}
          className={`lg-refraction-poc-card ${isAnimating ? 'is-refracting' : ''}`}
          onPointerDown={handlePointerDown}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              const rect = cardRef.current?.getBoundingClientRect();
              if (rect) {
                handlePointerDown({
                  clientX: rect.left + rect.width / 2,
                  clientY: rect.top + rect.height / 2,
                } as PointerEvent<HTMLDivElement>);
              }
            }
          }}
        >
          {/* Capa subyacente desplazada por SVG feDisplacementMap (desacople total del texto) */}
          <div
            className="lg-refraction-poc-underlay"
            aria-hidden="true"
            style={
              mode === 'refraction' && !shouldReduceMotion
                ? { filter: `url(#${filterId})` }
                : undefined
            }
          >
            <div className="lg-refraction-poc-grid" />
            <span className="lg-refraction-poc-watermark">KANI ATELIER · 蟹 · 10–20 HS</span>
          </div>

          {/* Lámina de cristal translúcido */}
          <div className="lg-refraction-poc-glass" aria-hidden="true" />

          {/* Texto siempre nítido sobre la capa óptica */}
          <div className="lg-refraction-poc-content">
            <div>
              <div className="lg-refraction-poc-title">Corte</div>
              <div className="lg-refraction-poc-sub">45 minutos</div>
            </div>
            <div className="lg-refraction-poc-price">$25.000</div>
          </div>
        </div>

        <p className="lg-refraction-poc-telemetry" aria-live="polite">
          {lastOrigin
            ? `Origen de contacto: (${lastOrigin.x}px, ${lastOrigin.y}px) · Modo: ${
                mode === 'refraction' ? 'Refracción espacial SVG' : 'Solo backdrop blur'
              }`
            : 'Presioná sobre la superficie de cristal para evaluar la deformación óptica.'}
        </p>

        <div className="lg-refraction-poc-notes">
          <strong>Nota técnica (Safari iOS / WebKit):</strong> CSS <code>backdrop-filter: url(#svg)</code> no está
          soportado en Safari iOS ni en la mayoría de navegadores para deformar píxeles arbitrarios detrás de un nodo
          HTML. Por eso este POC aplica <code>filter: url(#feDisplacementMap)</code> sobre un plano subyacente propio y
          mantiene aislado el flujo real de reservas con Living Surface V3.
        </div>

        <a className="lg-refraction-poc-back" href="/reservar-turno-liquid">
          Volver a /reservar-turno-liquid
        </a>
      </div>
    </section>
  );
}
