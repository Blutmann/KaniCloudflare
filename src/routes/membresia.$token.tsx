import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Calendar,
  Loader2,
  QrCode,
  RotateCw,
  ShieldAlert,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { pageHead } from "@/lib/kani-head";
import {
  getPublicMembershipCard,
  type PublicMembershipCardResult,
} from "@/lib/kani-recurrences-memberships";
import kaniKanjiStamp from "@/assets/kani-kanji-stamp.png";
import kaniLogoDark from "@/assets/kani-logo-dark.png";

export const Route = createFileRoute("/membresia/$token")({
  head: () => ({
    ...pageHead(
      "Black Membership · KANI Barber Studio",
      "Credencial digital oficial de membresía KANI Barber Studio.",
      "KANI Barber Studio - Private Membership",
    ),
    meta: [{ name: "robots", content: "noindex, nofollow, noarchive" }],
  }),
  component: PublicMembershipCardPage,
});

const SPANISH_MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

/**
 * Formato pasaporte de lujo: DD MMM AA (e.g. 09 NOV 26)
 */
function formatPassportDate(isoString?: string | null): string {
  if (!isoString) return "";
  const clean = isoString.replace("Z", "");
  const [datePart] = clean.split("T");
  if (!datePart) return "";
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) return "";
  const mIndex = parseInt(month, 10) - 1;
  const monthStr = SPANISH_MONTHS[mIndex] || month;
  const shortYear = year.slice(-2);
  return `${day} ${monthStr} ${shortYear}`;
}

/**
 * Formato editorial para historial: DD/MM/AAAA · HH:mm hs
 */
function formatArgentinaDateTime(isoString?: string | null): string {
  if (!isoString) return "";
  const clean = isoString.replace("Z", "");
  const [datePart, timePart] = clean.split("T");
  if (!datePart) return isoString;
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) return isoString;
  const time = timePart ? ` · ${timePart.slice(0, 5)} hs` : "";
  return `${day}/${month}/${year}${time}`;
}

/**
 * Renderizador SVG estándar de código QR de alto contraste y lectura directa por cámara/jsQR.
 */
function KaniQRCode({
  value,
  size = 240,
  className = "",
  margin = 3,
  fgColor = "#000000",
  bgColor = "#FFFFFF",
}: {
  value: string;
  size?: number;
  className?: string;
  margin?: number;
  fgColor?: string;
  bgColor?: string;
}) {
  const [svgString, setSvgString] = useState<string>("");

  useEffect(() => {
    let isMounted = true;
    QRCode.toString(value, {
      type: "svg",
      margin,
      color: {
        dark: fgColor,
        light: bgColor,
      },
    })
      .then((svg) => {
        if (isMounted) setSvgString(svg);
      })
      .catch((err) => {
        console.error("Error generando código QR:", err);
      });

    return () => {
      isMounted = false;
    };
  }, [value, margin, fgColor, bgColor]);

  return (
    <div
      style={{ width: size, height: size }}
      className={`inline-flex items-center justify-center bg-white rounded-lg select-none overflow-hidden ${className}`}
      dangerouslySetInnerHTML={{ __html: svgString }}
    />
  );
}

export function PublicMembershipCardPage() {
  const { token } = Route.useParams();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PublicMembershipCardResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Referencias para manipulación 3D continua de alto rendimiento (Pointer Events)
  const sceneRef = useRef<HTMLDivElement>(null);
  const flipperRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const isHorizontalDragRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startAngleRef = useRef(0);
  const currentAngleRef = useRef(0);
  const hasMovedRef = useRef(false);
  const lastTimeRef = useRef(0);
  const lastXRef = useRef(0);
  const velocityXRef = useRef(0);

  // Aislamiento absoluto de la credencial (oculta el cascarón global de la web)
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.body.setAttribute("data-membership-page", "true");
    }
    return () => {
      if (typeof document !== "undefined") {
        document.body.removeAttribute("data-membership-page");
      }
    };
  }, []);

  // Cierre de modal con Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isModalOpen) {
        setIsModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isModalOpen]);

  useEffect(() => {
    if (!token || token.trim().length < 16) {
      setError("INVALID_TOKEN");
      setLoading(false);
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        const card = await getPublicMembershipCard(token);
        if (!isMounted) return;
        if (!card.found) {
          setError(card.error || "NOT_FOUND_OR_REVOKED");
        } else {
          setData(card);
        }
      } catch {
        if (!isMounted) return;
        setError("LOAD_FAILED");
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [token]);

  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setScene3DState = useCallback((mode: "3d" | "settled-front" | "settled-back") => {
    if (!sceneRef.current) return;
    sceneRef.current.classList.remove("is-3d-active", "is-settled-front", "is-settled-back");
    if (mode === "3d") {
      sceneRef.current.classList.add("is-3d-active");
    } else {
      sceneRef.current.classList.add(mode === "settled-front" ? "is-settled-front" : "is-settled-back");
      if (flipperRef.current) {
        flipperRef.current.style.transition = "none";
        flipperRef.current.style.transform = "";
      }
    }
  }, []);

  const scheduleSettle = useCallback(
    (targetFlipped: boolean, delayMs: number = 470) => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        if (isDraggingRef.current) return;
        const normalized = targetFlipped ? 180 : 0;
        currentAngleRef.current = normalized;
        if (flipperRef.current) {
          flipperRef.current.setAttribute("data-angle-y", String(normalized));
        }
        setScene3DState(targetFlipped ? "settled-back" : "settled-front");
      }, delayMs);
    },
    [setScene3DState],
  );

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, []);

  const applyTransform = useCallback((angleY: number, tiltX: number = 0, animated: boolean = true) => {
    if (!flipperRef.current) return;
    if (animated) {
      flipperRef.current.style.transition = "transform 0.45s cubic-bezier(0.2, 0.9, 0.3, 1)";
    } else {
      flipperRef.current.style.transition = "none";
    }
    flipperRef.current.style.transform = `rotateY(${angleY}deg) rotateX(${tiltX}deg)`;
    flipperRef.current.setAttribute("data-angle-y", String(Math.round(angleY)));
    currentAngleRef.current = angleY;
  }, []);

  const toggleFlip = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    const currentStep = Math.round(currentAngleRef.current / 180);
    const currentlyFlipped = Math.abs(currentStep) % 2 === 1;
    const nextFlipped = !currentlyFlipped;
    const targetAngle = nextFlipped ? currentStep * 180 + 180 : currentStep * 180 - 180;

    setScene3DState("3d");
    if (flipperRef.current) {
      flipperRef.current.style.transition = "none";
      flipperRef.current.style.transform = `rotateY(${currentAngleRef.current}deg) rotateX(0deg)`;
      void flipperRef.current.offsetWidth;
    }

    applyTransform(targetAngle, 0, true);
    setIsFlipped(nextFlipped);
    scheduleSettle(nextFlipped, 470);
  }, [applyTransform, scheduleSettle, setScene3DState]);

  const activePointerIdRef = useRef<number | null>(null);

  const updateDragFromClientPos = useCallback(
    (clientX: number, clientY: number) => {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
      const deltaX = clientX - startXRef.current;
      const deltaY = clientY - startYRef.current;

      if (Math.hypot(deltaX, deltaY) > 4) {
        hasMovedRef.current = true;
      }

      if (!isHorizontalDragRef.current) {
        if (Math.abs(deltaX) > 6 && Math.abs(deltaX) >= Math.abs(deltaY) * 0.75) {
          isHorizontalDragRef.current = true;
          setScene3DState("3d");
        } else if (Math.abs(deltaY) > 10 && Math.abs(deltaY) > Math.abs(deltaX) * 1.4) {
          // Respeta el scroll vertical natural en dispositivos táctiles sin girar la tarjeta
          return;
        }
      }

      const now = performance.now();
      const dt = now - lastTimeRef.current;
      if (dt > 0) {
        velocityXRef.current = (clientX - lastXRef.current) / dt;
        lastTimeRef.current = now;
        lastXRef.current = clientX;
      }

      const sceneWidth = sceneRef.current?.getBoundingClientRect().width || 320;
      const degPerPx = 180 / Math.max(180, sceneWidth * 0.62);
      const newAngle = startAngleRef.current + deltaX * degPerPx;
      const tiltX = Math.max(-10, Math.min(10, -deltaY * 0.1));

      if (isHorizontalDragRef.current || Math.abs(deltaX) > 4) {
        setScene3DState("3d");
        if (flipperRef.current) {
          flipperRef.current.style.transition = "none";
          flipperRef.current.style.transform = `rotateY(${newAngle}deg) rotateX(${tiltX}deg)`;
          flipperRef.current.setAttribute("data-angle-y", String(Math.round(newAngle)));
        }
        currentAngleRef.current = newAngle;
      }
    },
    [setScene3DState],
  );

  const finishDragGesture = useCallback(
    (pointerId?: number, cancelled: boolean = false) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      const wasHorizontal = isHorizontalDragRef.current;
      isHorizontalDragRef.current = false;
      activePointerIdRef.current = null;

      if (pointerId !== undefined && sceneRef.current) {
        try {
          sceneRef.current.releasePointerCapture(pointerId);
        } catch {
          // Ignorar si no estaba capturado
        }
      }

      if (cancelled) {
        const settleAngle = Math.round(startAngleRef.current / 180) * 180;
        const flippedAfterCancel = Math.abs(Math.round(settleAngle / 180)) % 2 === 1;
        applyTransform(settleAngle, 0, true);
        setIsFlipped(flippedAfterCancel);
        scheduleSettle(flippedAfterCancel, 220);
        return;
      }

      if (!hasMovedRef.current) {
        toggleFlip();
        return;
      }

      if (!wasHorizontal) {
        const settleAngle = Math.round(startAngleRef.current / 180) * 180;
        const keepFlipped = Math.abs(Math.round(settleAngle / 180)) % 2 === 1;
        applyTransform(settleAngle, 0, true);
        setIsFlipped(keepFlipped);
        scheduleSettle(keepFlipped, 220);
        return;
      }

      const startAngle = startAngleRef.current;
      const current = currentAngleRef.current;
      const velocity = velocityXRef.current;
      const deltaAngle = current - startAngle;

      let targetAngle: number;
      if (Math.abs(velocity) > 0.35) {
        const stepDir = velocity > 0 ? 1 : -1;
        const baseStep = Math.round(startAngle / 180) * 180;
        targetAngle = baseStep + stepDir * 180;
      } else if (Math.abs(deltaAngle) >= 60) {
        const stepDir = deltaAngle > 0 ? 1 : -1;
        const baseStep = Math.round(startAngle / 180) * 180;
        targetAngle = Math.abs(deltaAngle) > 270 ? Math.round(current / 180) * 180 : baseStep + stepDir * 180;
      } else {
        targetAngle = Math.round(startAngle / 180) * 180;
      }

      applyTransform(targetAngle, 0, true);
      const flippedAfter = Math.abs(Math.round(targetAngle / 180)) % 2 === 1;
      setIsFlipped(flippedAfter);
      scheduleSettle(flippedAfter, 470);
    },
    [applyTransform, scheduleSettle, toggleFlip],
  );

  useEffect(() => {
    const onWinPointerMove = (ev: PointerEvent) => {
      if (!isDraggingRef.current) return;
      if (activePointerIdRef.current !== null && ev.pointerId !== activePointerIdRef.current) return;
      updateDragFromClientPos(ev.clientX, ev.clientY);
    };

    const onWinPointerUp = (ev: PointerEvent) => {
      if (!isDraggingRef.current) return;
      if (activePointerIdRef.current !== null && ev.pointerId !== activePointerIdRef.current) return;
      finishDragGesture(ev.pointerId, false);
    };

    const onWinPointerCancel = (ev: PointerEvent) => {
      if (!isDraggingRef.current) return;
      if (activePointerIdRef.current !== null && ev.pointerId !== activePointerIdRef.current) return;
      finishDragGesture(ev.pointerId, true);
    };

    window.addEventListener("pointermove", onWinPointerMove);
    window.addEventListener("pointerup", onWinPointerUp);
    window.addEventListener("pointercancel", onWinPointerCancel);

    return () => {
      window.removeEventListener("pointermove", onWinPointerMove);
      window.removeEventListener("pointerup", onWinPointerUp);
      window.removeEventListener("pointercancel", onWinPointerCancel);
    };
  }, [updateDragFromClientPos, finishDragGesture]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isModalOpen) return;
    if ((e.target as HTMLElement).closest("button, a")) return;

    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);

    const idleAngle = Math.abs(Math.round(currentAngleRef.current / 180)) % 2 === 1 ? 180 : 0;
    if (currentAngleRef.current !== idleAngle && flipperRef.current) {
      flipperRef.current.style.transition = "none";
      flipperRef.current.style.transform = `rotateY(${idleAngle}deg) rotateX(0deg)`;
      currentAngleRef.current = idleAngle;
    }

    isDraggingRef.current = true;
    isHorizontalDragRef.current = false;
    activePointerIdRef.current = typeof e.pointerId === "number" ? e.pointerId : null;
    hasMovedRef.current = false;
    startXRef.current = Number.isFinite(e.clientX) ? e.clientX : 0;
    startYRef.current = Number.isFinite(e.clientY) ? e.clientY : 0;
    lastXRef.current = startXRef.current;
    lastTimeRef.current = performance.now();
    velocityXRef.current = 0;
    startAngleRef.current = currentAngleRef.current;

    // Capturamos puntero en mouse; en touch dejamos fluir pan-y hasta detectar arrastre horizontal
    if (e.pointerType !== "touch") {
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Ignorar si no soporta pointer capture
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isModalOpen || isDraggingRef.current) return;

    if (e.pointerType === "mouse" && sceneRef.current && flipperRef.current) {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      setScene3DState("3d");
      const rect = sceneRef.current.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width - 0.5;
      const relY = (e.clientY - rect.top) / rect.height - 0.5;
      const baseAngle = currentAngleRef.current;
      const tiltY = baseAngle + relX * 8;
      const tiltX = -relY * 6;
      flipperRef.current.style.transition = "transform 0.15s ease-out";
      flipperRef.current.style.transform = `rotateY(${tiltY}deg) rotateX(${tiltX}deg)`;
    }
  };

  const handlePointerLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) return;

    if (e.pointerType === "mouse" && flipperRef.current) {
      const targetFlipped = Math.abs(Math.round(currentAngleRef.current / 180)) % 2 === 1;
      applyTransform(targetFlipped ? 180 : 0, 0, true);
      scheduleSettle(targetFlipped, 240);
    }
  };

  // Estado de Carga
  if (loading) {
    return (
      <main className="kani-membership-pass min-h-[100dvh] w-full flex flex-col justify-center items-center py-6 px-4 bg-[#050505] text-[#EDECEC]">
        <div className="max-w-[320px] w-full bg-[#0D0B08] border border-[#231E17] rounded-2xl p-6 shadow-2xl text-center space-y-3">
          <Loader2 className="w-7 h-7 animate-spin text-[#C8A96B] mx-auto" />
          <p className="text-[10px] font-mono tracking-[0.25em] text-[#8C7A58] uppercase">
            KANI · PRIVATE MEMBERSHIP
          </p>
        </div>
      </main>
    );
  }

  // Estado de Error
  if (error || !data) {
    return (
      <main className="kani-membership-pass min-h-[100dvh] w-full flex flex-col justify-between items-center py-6 px-4 bg-[#050505] text-[#EDECEC]">
        <div className="w-full max-w-[380px] my-auto bg-gradient-to-b from-[#14110E] to-[#0A0908] border border-[#282117] rounded-2xl p-6 shadow-2xl text-center space-y-4">
          <div className="mx-auto w-11 h-11 rounded-full bg-rose-500/10 border border-rose-500/25 flex items-center justify-center text-rose-400">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-base font-serif font-bold text-white tracking-tight">
              Membresía no disponible
            </h1>
            <p className="text-xs text-[#808080] leading-relaxed">
              El enlace no es válido o ha sido sustituido por uno más reciente. Si renovaste o solicitaste una actualización, por favor revisá tu último correo electrónico o comunicate con nosotros.
            </p>
          </div>
        </div>

        <footer className="text-center text-[11px] text-[#443E35] tracking-widest py-4 font-mono">
          <p>© 2026 KANI Barber Studio</p>
        </footer>
      </main>
    );
  }

  const totalSessions = data.total_sessions || data.package_size || 4;
  const consumedSessions = data.consumed_sessions || 0;
  const remainingSessions = data.remaining_sessions ?? Math.max(0, totalSessions - consumedSessions);
  const isExhausted = remainingSessions <= 0 || data.status === "EXHAUSTED";

  const compactPlan =
    totalSessions === 10 || data.plan_name?.includes("10")
      ? "10 SESIONES"
      : `${totalSessions} SESIONES`;

  const expiresLabel = data.expires_at ? formatPassportDate(data.expires_at) : "SIN VENCIMIENTO";

  const allConsumptions = data.consumptions || [];
  const validConsumptions = allConsumptions.filter((c) => c.status === "CONSUMED");

  let statusKey = data.status || "ACTIVE";
  if (isExhausted) {
    statusKey = "COMPLETED";
  }

  const statusConfig: Record<string, { label: string; bg: string; text: string; border: string }> = {
    ACTIVE: {
      label: "Activa",
      bg: "rgba(16, 185, 129, 0.08)",
      text: "#10b981",
      border: "rgba(16, 185, 129, 0.25)",
    },
    COMPLETED: {
      label: "Completada",
      bg: "rgba(200, 169, 107, 0.10)",
      text: "#C8A96B",
      border: "rgba(200, 169, 107, 0.3)",
    },
    PENDING_PAYMENT: {
      label: "Pendiente",
      bg: "rgba(245, 158, 11, 0.08)",
      text: "#f59e0b",
      border: "rgba(245, 158, 11, 0.25)",
    },
    EXPIRED: {
      label: "Vencida",
      bg: "rgba(239, 68, 68, 0.08)",
      text: "#ef4444",
      border: "rgba(239, 68, 68, 0.25)",
    },
    CANCELLED: {
      label: "Cancelada",
      bg: "rgba(156, 163, 175, 0.08)",
      text: "#9ca3af",
      border: "rgba(156, 163, 175, 0.25)",
    },
  };

  const currentStatus = statusConfig[statusKey] || statusConfig.ACTIVE;

  const verificationUrl =
    typeof window !== "undefined" && window.location.origin
      ? `${window.location.origin}/verificar-membresia/${token}`
      : `https://www.kanibarber.com/verificar-membresia/${token}`;

  const shortSerial = token.slice(0, 8).toUpperCase();

  return (
    <main
      className="kani-membership-pass min-h-[100dvh] w-full flex flex-col justify-between items-center pt-[max(0.875rem,env(safe-area-inset-top))] sm:pt-5 lg:pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] px-3 sm:px-6 text-[#EDECEC] select-none antialiased relative overflow-x-hidden"
      style={{
        backgroundColor: "#040405",
        backgroundImage: `
          radial-gradient(ellipse at 50% 20%, rgba(200, 169, 107, 0.08) 0%, transparent 60%),
          radial-gradient(circle at 15% 35%, rgba(200, 169, 107, 0.03) 0%, transparent 40%),
          linear-gradient(to bottom, rgba(4, 4, 5, 0.72) 0%, rgba(4, 4, 5, 0.90) 100%),
          url('/kani-background-desktop.webp')
        `,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundAttachment: "fixed",
      }}
    >
      {/* Acción superior izquierda fuera de la credencial */}
      <div className="w-full flex items-center justify-start pb-3 sm:pb-3.5 shrink-0">
        <a
          href="https://www.kanibarber.com/reservar-turno"
          className="inline-flex items-center gap-2 sm:gap-2.5 min-h-[42px] sm:min-h-[44px] md:min-h-[46px] px-4 py-2.5 sm:px-5 md:px-6 md:py-3 rounded-full bg-[#08080A]/95 hover:bg-[#141418] border border-[#D4B475]/60 hover:border-[#F0D9A3] text-[#F0D9A3] hover:text-white transition-all text-[11.5px] sm:text-xs md:text-[13px] font-mono font-semibold tracking-[0.16em] uppercase shadow-[0_8px_24px_rgba(0,0,0,0.65),0_0_14px_rgba(212,180,117,0.10)] backdrop-blur-sm whitespace-nowrap"
        >
          <Calendar className="w-4 h-4 md:w-[18px] md:h-[18px] text-[#D4B475] shrink-0" />
          <span>RESERVAR TURNO</span>
        </a>
      </div>

      <div className="w-full max-w-[420px] sm:max-w-[560px] md:max-w-[680px] lg:max-w-[760px] xl:max-w-[800px] 2xl:max-w-[840px] mx-auto my-auto space-y-4 md:space-y-5 flex flex-col items-center">
        {/* Micro-píldora sutil para alternar cara */}
        <button
          onClick={toggleFlip}
          type="button"
          aria-label={isFlipped ? "Ver frente de la credencial" : "Ver reverso de la credencial"}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#09090B]/95 hover:bg-[#141417] border border-[#C8A96B]/30 text-[#9B8A68] hover:text-[#F0D9A3] transition-colors text-[9.5px] md:text-[10.5px] font-mono tracking-[0.22em] uppercase cursor-pointer shadow-lg backdrop-blur-sm"
        >
          <RotateCw
            className="w-3 h-3 md:w-3.5 md:h-3.5 text-[#D4B475] transition-transform duration-500"
            style={{ transform: isFlipped ? "rotate(180deg)" : "none" }}
          />
          <span>{isFlipped ? "FRENTE" : "REVERSO"}</span>
        </button>

        {/* ===================================================================
            ESCENARIO FOTOGRÁFICO Y CREDENCIAL 3D CON INTERACCIÓN CONTINUA
            =================================================================== */}
        <div
          ref={sceneRef}
          data-testid="kani-card-3d-scene"
          className="kani-card-3d-scene is-settled-front relative cursor-grab active:cursor-grabbing select-none focus:outline-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              toggleFlip();
            }
          }}
          tabIndex={0}
          role="region"
          aria-label="Credencial interactiva 3D KANI"
        >
          {/* Sombra de contacto proyectada en el plano inferior */}
          <div
            className="absolute -bottom-4 inset-x-8 h-7 rounded-[100%] bg-black/90 blur-md pointer-events-none transition-opacity duration-300"
            style={{ opacity: 0.9 }}
          />

          <div
            ref={flipperRef}
            data-testid="kani-card-flipper"
            data-angle-y={isFlipped ? "180" : "0"}
            className="kani-card-3d-flipper"
          >
            {/* ===============================================================
                CARA A: FRENTE (NEGRO OBSIDIANA MATE, WORDMARK Y GRABADO KANJI)
                =============================================================== */}
            <div
              className="kani-card-3d-face relative overflow-hidden rounded-[22px] sm:rounded-[26px] md:rounded-[30px] lg:rounded-[32px] bg-[linear-gradient(145deg,#121214_0%,#09090B_52%,#040405_100%)] border border-[#C8A96B]/40 p-5 sm:p-7 md:p-9 lg:p-10 xl:p-11 min-h-[268px] sm:min-h-[368px] md:min-h-[444px] lg:min-h-[496px] xl:min-h-[520px] 2xl:min-h-[546px] flex flex-col justify-between"
              style={{
                boxShadow:
                  "0 0 0 1px rgba(212, 180, 117, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 38px 75px -12px rgba(0, 0, 0, 0.96)",
              }}
            >
              <div className="absolute top-0 inset-x-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#D4B475]/75 to-transparent" />

              {/* Sello kanji bordó decorativo de fondo */}
              <div className="absolute right-4 bottom-10 sm:right-7 sm:bottom-12 md:right-10 md:bottom-14 lg:right-12 lg:bottom-16 w-24 h-24 sm:w-32 sm:h-32 md:w-40 md:h-40 lg:w-44 lg:h-44 xl:w-48 xl:h-48 opacity-[0.14] pointer-events-none select-none overflow-hidden">
                <img
                  src={kaniKanjiStamp}
                  alt=""
                  className="w-full h-full object-contain"
                  style={{ filter: "brightness(1.18) contrast(1.06)" }}
                />
              </div>

              {/* Fila Superior Frente: Logo KANI dorado + VIP CLIENT + Estado */}
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] pb-3 md:pb-4 lg:pb-5 relative z-10">
                <div className="flex items-center gap-2.5 sm:gap-3.5 md:gap-4">
                  <img
                    src={kaniLogoDark}
                    alt="KANI Barber Studio"
                    className="h-9 sm:h-12 md:h-14 lg:h-[60px] xl:h-[64px] w-auto object-contain select-none shrink-0"
                  />
                  <span className="h-5 md:h-7 w-[1px] bg-[#C8A96B]/25 shrink-0" aria-hidden="true" />
                  <span className="text-[9px] sm:text-xs md:text-[13px] lg:text-sm tracking-[0.18em] sm:tracking-[0.26em] text-[#D4B475] uppercase font-mono font-semibold whitespace-nowrap">
                    VIP CLIENT
                  </span>
                </div>

                <div
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 md:px-3.5 md:py-1 rounded-full text-[9.5px] sm:text-[11px] md:text-xs lg:text-[12.5px] font-semibold tracking-[0.15em] border font-mono shrink-0"
                  style={{
                    backgroundColor: currentStatus.bg,
                    color: currentStatus.text,
                    borderColor: currentStatus.border,
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current opacity-85" />
                  {currentStatus.label}
                </div>
              </div>

              {/* Zona Central Frente: TITULAR + Nombre en Zen Antique */}
              <div className="my-auto py-3.5 md:py-6 relative z-10">
                <span className="text-[9.5px] sm:text-[10.5px] md:text-xs tracking-[0.25em] text-[#8E8B84] uppercase font-mono block mb-1.5">
                  TITULAR
                </span>
                <h1
                  className="text-[23px] sm:text-[32px] md:text-[39px] lg:text-[45px] xl:text-[49px] font-serif font-bold text-white tracking-tight leading-tight break-words"
                  style={{ fontFamily: "'Zen Antique', Georgia, serif" }}
                >
                  {data.client_name}
                </h1>
              </div>

              {/* Fila Inferior Frente: BARBERO & Cantidad de sesiones */}
              <div className="flex items-end justify-between pt-3 md:pt-4 lg:pt-5 border-t border-white/[0.08] relative z-10">
                <div className="space-y-0.5 md:space-y-1 font-mono">
                  <span className="text-[9.5px] sm:text-[10.5px] md:text-xs tracking-[0.22em] text-[#8E8B84] uppercase block">
                    BARBERO
                  </span>
                  <span className="text-[13.5px] sm:text-[15px] md:text-lg lg:text-[19px] text-[#F2F0EC] font-medium tracking-wide">
                    {data.barber_name}
                  </span>
                </div>

                <span className="text-[10.5px] sm:text-xs md:text-[13px] lg:text-sm font-mono font-semibold tracking-[0.2em] text-[#D4B475] uppercase">
                  {compactPlan}
                </span>
              </div>
            </div>

            {/* ===============================================================
                CARA B: REVERSO (NEGRO OBSIDIANA MATE, PRIVATE PASS, SELLOS KANJI)
                =============================================================== */}
            <div
              className="kani-card-3d-face kani-card-3d-back relative overflow-hidden rounded-[22px] sm:rounded-[26px] md:rounded-[30px] lg:rounded-[32px] bg-[linear-gradient(145deg,#121214_0%,#09090B_52%,#040405_100%)] border border-[#C8A96B]/40 p-4 sm:p-7 md:p-9 lg:p-10 xl:p-11 min-h-[268px] sm:min-h-[368px] md:min-h-[444px] lg:min-h-[496px] xl:min-h-[520px] 2xl:min-h-[546px] flex flex-col justify-between"
              style={{
                boxShadow:
                  "0 0 0 1px rgba(212, 180, 117, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 38px 75px -12px rgba(0, 0, 0, 0.96)",
              }}
            >
              <div className="absolute top-0 inset-x-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#D4B475]/75 to-transparent" />

              {/* 1. Encabezado Reverso: PRIVATE PASS + Sesiones y vencimiento */}
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5 md:pb-3.5 lg:pb-4">
                <span className="text-[9.5px] sm:text-xs md:text-[13px] lg:text-sm tracking-[0.20em] sm:tracking-[0.26em] text-[#D4B475] uppercase font-mono font-semibold whitespace-nowrap">
                  PRIVATE PASS
                </span>

                <div className="font-mono text-[8.5px] sm:text-[11px] md:text-xs lg:text-[13px] tracking-wider text-[#9A968E] whitespace-nowrap">
                  <strong className="text-[#F0D9A3] font-semibold">{compactPlan}</strong>
                  <span className="text-[#3C3B38] mx-1 sm:mx-1.5">•</span>
                  <span className="text-[#C7C2B8] font-medium">{expiresLabel}</span>
                </div>
              </div>

              {/* 2. Zona de Sellos Kanji (círculos horizontales 4 ó cuadrícula 5x2 para 10) */}
              <div className="py-2 sm:py-3 md:py-4">
                <div
                  className={`grid ${
                    totalSessions === 10
                      ? "grid-cols-5 gap-1.5 sm:gap-3 md:gap-4 lg:gap-5"
                      : "grid-cols-4 gap-2 sm:gap-4 md:gap-5 lg:gap-7"
                  }`}
                >
                  {Array.from({ length: totalSessions }).map((_, index) => {
                    const isConsumed = index < consumedSessions;
                    const consumptionInfo = isConsumed ? validConsumptions[index] : null;

                    if (isConsumed) {
                      return (
                        <div
                          key={`kanji-stamp-${index}`}
                          className="aspect-square rounded-full relative overflow-hidden border border-[#9A7F4D]/65 shadow-[inset_0_0_10px_rgba(0,0,0,0.85)]"
                          style={{
                            background: "radial-gradient(circle, #0D0D0F 0%, #060607 100%)",
                          }}
                        >
                          <img
                            src={kaniKanjiStamp}
                            alt="Sello Kanji KANI"
                            className={`absolute left-1/2 top-[43.5%] ${
                              totalSessions === 10 ? "w-[33%] h-[33%]" : "w-[35%] h-[35%]"
                            } object-contain select-none`}
                            style={{
                              transform: "translate(-50%, -50%)",
                              filter: "brightness(1.22) contrast(1.1)",
                            }}
                          />
                          <span
                            className={`absolute inset-x-0 bottom-[16%] sm:bottom-[15%] md:bottom-[14.5%] text-center ${
                              totalSessions === 10
                                ? "text-[7px] sm:text-[9px] md:text-[10px] lg:text-[10.5px] tracking-[0.02em] sm:tracking-[0.05em]"
                                : "text-[8.5px] sm:text-[10.5px] md:text-[12px] lg:text-[12.5px] xl:text-[13px] tracking-[0.03em] sm:tracking-[0.07em]"
                            } font-mono text-[#EBD7AC] font-semibold leading-none uppercase whitespace-nowrap`}
                          >
                            {consumptionInfo?.consumed_at
                              ? formatPassportDate(consumptionInfo.consumed_at)
                              : "SELLADA"}
                          </span>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={`kanji-stamp-${index}`}
                        className="aspect-square rounded-full flex flex-col items-center justify-center text-center relative overflow-hidden bg-[#09090B] border border-[#232220] shadow-inner"
                      >
                        <img
                          src={kaniKanjiStamp}
                          alt=""
                          className="absolute inset-0 m-auto w-[36%] h-[36%] object-contain opacity-[0.06] pointer-events-none"
                        />
                        <span className="text-xs sm:text-sm md:text-base lg:text-lg font-mono font-medium text-[#7E7A72] tracking-widest relative z-10">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {isExhausted && (
                  <p className="text-[9.5px] sm:text-[11px] tracking-[0.24em] text-[#9B8A68] uppercase font-mono text-center pt-2.5">
                    MEMBERSHIP COMPLETED
                  </p>
                )}
              </div>

              {/* 3. Fila Inferior Reverso: Botón VERIFICAR y Serial */}
              <div className="flex items-center justify-between gap-2 pt-2.5 md:pt-3.5 lg:pt-4 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsModalOpen(true);
                  }}
                  className="relative inline-flex items-center justify-center min-h-[44px] min-w-[44px] -my-1 md:my-0 bg-transparent border-0 p-0 cursor-pointer group focus:outline-none"
                  aria-label="Abrir código QR de verificación"
                >
                  <span className="inline-flex items-center justify-center gap-1.5 sm:gap-2 h-[35px] md:min-h-[44px] px-3.5 sm:px-5 md:px-6 md:py-2.5 rounded-full bg-[#070708] group-hover:bg-[#141418] border border-[#D4B475]/85 group-hover:border-[#F2DFB4] text-[#F0D9A3] group-hover:text-white transition-all text-[9.5px] sm:text-xs md:text-[13px] lg:text-[13.5px] font-mono font-semibold tracking-[0.16em] md:tracking-[0.18em] shadow-[0_0_18px_rgba(212,180,117,0.14)] whitespace-nowrap">
                    <QrCode className="w-3.5 h-3.5 md:w-[18px] md:h-[18px] text-[#D4B475] shrink-0" />
                    <span>VERIFICAR</span>
                  </span>
                </button>

                <span className="text-[8px] sm:text-[10px] md:text-[11px] lg:text-xs font-mono tracking-[0.12em] sm:tracking-[0.18em] text-[#8E8B84] uppercase whitespace-nowrap">
                  #{shortSerial} · SOLO LECTURA
                </span>
              </div>
            </div>
          </div>
        </div>

        <p className="pt-3.5 pb-1 sm:pt-4 sm:pb-1.5 md:pt-5 md:pb-2 text-center text-[9.5px] sm:text-[10px] md:text-[10.5px] font-mono tracking-[0.22em] text-[#837E74] uppercase">
          DESLIZÁ HORIZONTALMENTE PARA GIRAR
        </p>

        {/* ===================================================================
            HISTORIAL DE VISITAS
            =================================================================== */}
        {allConsumptions.length > 0 && (
          <div className="w-full space-y-2 pt-1.5">
            <span className="text-[9px] sm:text-[10px] tracking-[0.28em] text-[#B89B62] uppercase font-mono block px-1">
              HISTORIAL DE VISITAS
            </span>

            <div className="rounded-xl bg-[#070708]/92 border border-white/[0.08] divide-y divide-white/[0.06] px-4 sm:px-5 py-0.5 backdrop-blur-sm shadow-xl">
              {allConsumptions.map((c, idx) => {
                const isRefunded = c.status === "REFUNDED" || c.status === "VOIDED";
                return (
                  <div
                    key={`hist-${idx}`}
                    className="flex items-center justify-between gap-3 py-3.5 sm:py-4"
                  >
                    <div className="space-y-1 sm:space-y-1.5">
                      <strong
                        className={`text-[13px] sm:text-sm font-medium leading-snug block ${
                          isRefunded ? "text-[#7A7770] line-through" : "text-[#F0EDE6]"
                        }`}
                      >
                        {c.service_name}
                      </strong>
                      <span className="text-[10.5px] sm:text-[11.5px] text-[#8E897F] font-mono leading-none block">
                        {formatArgentinaDateTime(c.consumed_at)}
                      </span>
                    </div>

                    {isRefunded && (
                      <span className="text-[9px] sm:text-[9.5px] text-amber-300/90 font-mono tracking-[0.14em] uppercase border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 rounded shrink-0">
                        REINTEGRADO
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ===================================================================
          FOOTER AUTÓNOMO
          =================================================================== */}
      <footer className="w-full text-center text-[10px] sm:text-[10.5px] text-[#66625B] tracking-[0.2em] uppercase font-mono pt-6 pb-1 shrink-0">
        <p>© 2026 KANI Barber Studio</p>
      </footer>

      {/* ===================================================================
          MODAL AMPLIADO DE VERIFICACIÓN QR — VERIFICACIÓN EN KANI
          =================================================================== */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/82 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="w-full max-w-[440px] sm:max-w-[440px] md:max-w-[470px] bg-gradient-to-b from-[#111113] to-[#060607] border border-[#C8A96B]/40 rounded-2xl sm:rounded-3xl p-5 sm:p-7 md:p-8 shadow-[0_28px_70px_rgba(0,0,0,0.96)] text-center space-y-3.5 sm:space-y-4 md:space-y-5 relative my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="absolute top-3.5 right-3.5 sm:top-4 sm:right-4 p-2 rounded-full text-[#9B8A68] hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              aria-label="Cerrar ventana de verificación"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <div className="space-y-1.5 sm:space-y-2 px-6">
              <img
                src={kaniLogoDark}
                alt="KANI Barber Studio"
                className="h-8 sm:h-10 md:h-11 w-auto mx-auto object-contain select-none"
              />
              <span className="text-[8.5px] sm:text-[9.5px] md:text-[10px] font-mono tracking-[0.28em] text-[#C8A96B] uppercase block pt-0.5">
                CREDENCIAL DIGITAL OFICIAL
              </span>
              <h2
                id="qr-modal-title"
                className="text-lg sm:text-xl md:text-2xl font-serif font-bold text-white tracking-tight"
                style={{ fontFamily: "'Zen Antique', Georgia, serif" }}
              >
                Verificación en Kani
              </h2>
            </div>

            <div className="mx-auto w-[196px] h-[196px] min-[360px]:w-[218px] min-[360px]:h-[218px] sm:w-[244px] sm:h-[244px] md:w-[258px] md:h-[258px] bg-white rounded-2xl p-2.5 sm:p-3 flex items-center justify-center shadow-xl">
              <KaniQRCode
                value={verificationUrl}
                size={240}
                className="!w-full !h-full [&_svg]:w-full [&_svg]:h-full"
                fgColor="#000000"
                bgColor="#FFFFFF"
              />
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-left bg-[#080706] border border-[#242018] rounded-xl px-4 py-3 sm:px-5 sm:py-3.5 font-mono text-[11px] sm:text-xs md:text-[13px]">
              <div className="truncate">
                <span className="text-[#867C68] block text-[8.5px] sm:text-[9.5px] tracking-[0.16em] mb-0.5">TITULAR</span>
                <span className="text-white font-medium">{data.client_name}</span>
              </div>
              <div className="truncate">
                <span className="text-[#867C68] block text-[8.5px] sm:text-[9.5px] tracking-[0.16em] mb-0.5">PROFESIONAL</span>
                <span className="text-[#E6E2DA]">{data.barber_name}</span>
              </div>
              <div>
                <span className="text-[#867C68] block text-[8.5px] sm:text-[9.5px] tracking-[0.16em] mb-0.5">DISPONIBLES</span>
                <span className="text-[#D4B475] font-semibold">
                  {remainingSessions} de {totalSessions}
                </span>
              </div>
              <div>
                <span className="text-[#867C68] block text-[8.5px] sm:text-[9.5px] tracking-[0.16em] mb-0.5">SERIAL</span>
                <span className="text-[#A39E93]">#{shortSerial}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="w-full min-h-[44px] py-2.5 sm:py-3 rounded-xl bg-[#16130E] hover:bg-[#221D15] border border-[#D4B475]/45 hover:border-[#F0D9A3] text-[#F0D9A3] hover:text-white text-xs sm:text-[13px] font-mono font-semibold tracking-[0.2em] uppercase transition-colors cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export const BlackMembershipCardView = PublicMembershipCardPage;
