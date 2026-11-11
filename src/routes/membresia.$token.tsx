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
import { getPublicMembershipCard, type PublicMembershipCardResult } from "@/lib/kani-recurrences-memberships";
import kanjiStamp from "@/assets/kani-kanji-stamp.png";

export const Route = createFileRoute("/membresia/$token")({
  head: () => ({
    meta: [
      { title: "Black Membership · KANI Barber Studio" },
      { name: "description", content: "Credencial digital oficial de membresía KANI Barber Studio." },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: BlackMembershipCardView,
});

const MONTHS_ES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

function formatDateShort(dateStr?: string | null): string {
  if (!dateStr) return "";
  const [datePart] = dateStr.replace("Z", "").split("T");
  if (!datePart) return "";
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return "";
  return `${d} ${MONTHS_ES[parseInt(m, 10) - 1] || m} ${y.slice(-2)}`;
}

function formatDateTimeShort(dateStr?: string | null): string {
  if (!dateStr) return "";
  const [datePart, timePart] = dateStr.replace("Z", "").split("T");
  if (!datePart) return dateStr;
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}${timePart ? ` · ${timePart.slice(0, 5)} hs` : ""}`;
}

function QRCodeCanvas({
  value,
  size = 200,
  className = "",
  margin = 3,
  fgColor = "#000000",
  bgColor = "#ffffff",
}: {
  value: string;
  size?: number;
  className?: string;
  margin?: number;
  fgColor?: string;
  bgColor?: string;
}) {
  const [svgMarkup, setSvgMarkup] = useState("");
  useEffect(() => {
    let active = true;
    QRCode.toString(value, {
      type: "svg",
      margin,
      color: { dark: fgColor, light: bgColor },
    })
      .then((svg) => {
        if (active) setSvgMarkup(svg);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [value, margin, fgColor, bgColor]);

  return (
    <div
      style={{ width: size, height: size }}
      className={`bg-white rounded-lg flex items-center justify-center ${className}`}
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}

export function BlackMembershipCardView() {
  const { token } = Route.useParams();
  const [loading, setLoading] = useState(true);
  const [card, setCard] = useState<PublicMembershipCardResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const flipperRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartYRef = useRef(0);
  const dragStartAngleYRef = useRef(0);
  const currentAngleYRef = useRef(0);
  const hasDraggedFarRef = useRef(false);
  const lastMoveTimeRef = useRef(0);
  const lastMoveXRef = useRef(0);
  const velocityXRef = useRef(0);
  const activePointerIdRef = useRef<number | null>(null);
  const settleTimeoutRef = useRef<any>(null);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.body.setAttribute("data-membership-page", "true");
      return () => {
        document.body.removeAttribute("data-membership-page");
      };
    }
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isQrModalOpen) {
        setIsQrModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isQrModalOpen]);

  useEffect(() => {
    if (!token || token.trim().length < 16) {
      setError("INVALID_TOKEN");
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await getPublicMembershipCard(token);
        if (!active) return;
        if (res.found) {
          setCard(res);
        } else {
          setError(res.error || "NOT_FOUND_OR_REVOKED");
        }
      } catch {
        if (!active) return;
        setError("LOAD_FAILED");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const setCardStateMode = useCallback((mode: "3d" | "settled-front" | "settled-back") => {
    if (!containerRef.current) return;
    containerRef.current.classList.remove("is-3d-active", "is-settled-front", "is-settled-back");
    if (mode === "3d") {
      containerRef.current.classList.add("is-3d-active");
    } else {
      containerRef.current.classList.add(mode === "settled-front" ? "is-settled-front" : "is-settled-back");
      if (flipperRef.current) {
        flipperRef.current.style.transition = "none";
        flipperRef.current.style.transform = "";
      }
    }
  }, []);

  const settleTo = useCallback(
    (flipped: boolean, delay = 470) => {
      if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = setTimeout(() => {
        if (isDraggingRef.current) return;
        const target = flipped ? 180 : 0;
        currentAngleYRef.current = target;
        if (flipperRef.current) {
          flipperRef.current.setAttribute("data-angle-y", String(target));
        }
        setCardStateMode(flipped ? "settled-back" : "settled-front");
      }, delay);
    },
    [setCardStateMode],
  );

  useEffect(() => {
    return () => {
      if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    };
  }, []);

  const rotateCard = useCallback((angleY: number, angleX = 0, withTransition = true) => {
    if (!flipperRef.current) return;
    if (withTransition) {
      flipperRef.current.style.transition = "transform 0.45s cubic-bezier(0.2, 0.9, 0.3, 1)";
    } else {
      flipperRef.current.style.transition = "none";
    }
    flipperRef.current.style.transform = `rotateY(${angleY}deg) rotateX(${angleX}deg)`;
    flipperRef.current.setAttribute("data-angle-y", String(Math.round(angleY)));
    currentAngleYRef.current = angleY;
  }, []);

  const toggleFlip = useCallback(() => {
    if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    const rounded = Math.round(currentAngleYRef.current / 180);
    const nextFlipped = Math.abs(rounded) % 2 !== 1;
    const target = nextFlipped ? rounded * 180 + 180 : rounded * 180 - 180;
    setCardStateMode("3d");
    if (flipperRef.current) {
      flipperRef.current.style.transition = "none";
      flipperRef.current.style.transform = `rotateY(${currentAngleYRef.current}deg) rotateX(0deg)`;
      void flipperRef.current.offsetWidth;
    }
    rotateCard(target, 0, true);
    setIsFlipped(nextFlipped);
    settleTo(nextFlipped, 470);
  }, [rotateCard, settleTo, setCardStateMode]);

  const handlePointerMove = useCallback((clientX: number, clientY: number) => {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    const dx = clientX - dragStartXRef.current;
    const dy = clientY - dragStartYRef.current;
    if (Math.hypot(dx, dy) > 4) {
      hasDraggedFarRef.current = true;
    }
    const now = performance.now();
    const dt = now - lastMoveTimeRef.current;
    if (dt > 0) {
      velocityXRef.current = (clientX - lastMoveXRef.current) / dt;
      lastMoveTimeRef.current = now;
      lastMoveXRef.current = clientX;
    }
    const width = containerRef.current?.getBoundingClientRect().width || 320;
    const sensitivity = 180 / Math.max(180, width * 0.62);
    const angleY = dragStartAngleYRef.current + dx * sensitivity;
    const angleX = Math.max(-10, Math.min(10, -dy * 0.1));
    if (flipperRef.current) {
      flipperRef.current.style.transition = "none";
      flipperRef.current.style.transform = `rotateY(${angleY}deg) rotateX(${angleX}deg)`;
      flipperRef.current.setAttribute("data-angle-y", String(Math.round(angleY)));
    }
    currentAngleYRef.current = angleY;
  }, []);

  const handlePointerUp = useCallback(
    (pointerId?: number) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      activePointerIdRef.current = null;
      if (pointerId !== undefined && containerRef.current) {
        try {
          containerRef.current.releasePointerCapture(pointerId);
        } catch {}
      }
      if (!hasDraggedFarRef.current) {
        toggleFlip();
        return;
      }
      const startAngle = dragStartAngleYRef.current;
      const current = currentAngleYRef.current;
      const vel = velocityXRef.current;
      const delta = current - startAngle;
      let target: number;
      if (Math.abs(vel) > 0.35) {
        const dir = vel > 0 ? 1 : -1;
        target = Math.round(startAngle / 180) * 180 + dir * 180;
      } else if (Math.abs(delta) >= 60) {
        const dir = delta > 0 ? 1 : -1;
        const snap = Math.round(startAngle / 180) * 180;
        target = Math.abs(delta) > 270 ? Math.round(current / 180) * 180 : snap + dir * 180;
      } else {
        target = Math.round(startAngle / 180) * 180;
      }
      rotateCard(target, 0, true);
      const flipped = Math.abs(Math.round(target / 180)) % 2 === 1;
      setIsFlipped(flipped);
      settleTo(flipped, 470);
    },
    [rotateCard, settleTo, toggleFlip],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (isDraggingRef.current) {
        if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
        handlePointerMove(e.clientX, e.clientY);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (isDraggingRef.current) {
        if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
        handlePointerUp(e.pointerId);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isQrModalOpen || (e.target as HTMLElement).closest("button, a")) return;
    if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    setCardStateMode("3d");
    const settledAngle = Math.abs(Math.round(currentAngleYRef.current / 180)) % 2 === 1 ? 180 : 0;
    if (currentAngleYRef.current !== settledAngle && flipperRef.current) {
      flipperRef.current.style.transition = "none";
      flipperRef.current.style.transform = `rotateY(${settledAngle}deg) rotateX(0deg)`;
      currentAngleYRef.current = settledAngle;
    } else if (flipperRef.current && !flipperRef.current.style.transform) {
      flipperRef.current.style.transition = "none";
      flipperRef.current.style.transform = `rotateY(${settledAngle}deg) rotateX(0deg)`;
    }
    isDraggingRef.current = true;
    activePointerIdRef.current = typeof e.pointerId === "number" ? e.pointerId : null;
    hasDraggedFarRef.current = false;
    dragStartXRef.current = Number.isFinite(e.clientX) ? e.clientX : 0;
    dragStartYRef.current = Number.isFinite(e.clientY) ? e.clientY : 0;
    lastMoveXRef.current = dragStartXRef.current;
    lastMoveTimeRef.current = performance.now();
    velocityXRef.current = 0;
    dragStartAngleYRef.current = currentAngleYRef.current;
    if (flipperRef.current) {
      flipperRef.current.style.transition = "none";
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handleMouseMoveHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isQrModalOpen || isDraggingRef.current) return;
    if (e.pointerType === "mouse" && containerRef.current && flipperRef.current) {
      if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
      setCardStateMode("3d");
      const rect = containerRef.current.getBoundingClientRect();
      const normX = (e.clientX - rect.left) / rect.width - 0.5;
      const normY = (e.clientY - rect.top) / rect.height - 0.5;
      const angleY = currentAngleYRef.current + normX * 8;
      const angleX = -normY * 6;
      flipperRef.current.style.transition = "transform 0.15s ease-out";
      flipperRef.current.style.transform = `rotateY(${angleY}deg) rotateX(${angleX}deg)`;
    }
  };

  const handleMouseLeaveHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current && e.pointerType === "mouse" && flipperRef.current) {
      const flipped = Math.abs(Math.round(currentAngleYRef.current / 180)) % 2 === 1;
      rotateCard(flipped ? 180 : 0, 0, true);
      settleTo(flipped, 240);
    }
  };

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

  if (error || !card) {
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

  const totalSessions = card.total_sessions || card.package_size || 4;
  const consumedSessions = card.consumed_sessions || 0;
  const remainingSessions = card.remaining_sessions ?? Math.max(0, totalSessions - consumedSessions);
  const isCompleted = remainingSessions <= 0 || card.status === "EXHAUSTED";
  const planLabel = totalSessions === 10 || card.plan_name?.includes("10") ? "10 SESIONES" : `${totalSessions} SESIONES`;
  const expiresLabel = card.expires_at ? formatDateShort(card.expires_at) : "SIN VENCIMIENTO";
  const consumptionsList = card.consumptions || [];
  const effectiveStatus = isCompleted ? "COMPLETED" : (card.status || "ACTIVE");

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

  const statusBadge = statusConfig[effectiveStatus] || statusConfig.ACTIVE;
  const verificationUrl =
    typeof window !== "undefined" && window.location.origin
      ? `${window.location.origin}/verificar-membresia/${token}`
      : `https://www.kanibarber.com/verificar-membresia/${token}`;
  const serialToken = token.slice(0, 8).toUpperCase();

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
      <div className="w-full flex items-center justify-start pb-3 sm:pb-3.5 shrink-0">
        <a
          href="https://www.kanibarber.com/reservar-turno"
          className="inline-flex items-center gap-2 sm:gap-2.5 min-h-[42px] sm:min-h-[44px] md:min-h-[46px] px-4 py-2.5 sm:px-5 md:px-6 md:py-3 rounded-full bg-[#08080A]/95 hover:bg-[#141418] border border-[#D4B475]/60 hover:border-[#F0D9A3] text-[#F0D9A3] hover:text-white transition-all text-[11.5px] sm:text-xs md:text-[13px] font-mono font-semibold tracking-[0.16em] uppercase shadow-[0_8px_24px_rgba(0,0,0,0.65),0_0_14px_rgba(212,180,117,0.10)] backdrop-blur-sm whitespace-nowrap cursor-pointer"
        >
          <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#D4B475] shrink-0" />
          <span>RESERVAR TURNO</span>
        </a>
      </div>

      <div className="w-full flex-1 flex flex-col items-center justify-center py-2 sm:py-3 md:py-4">
        <div
          ref={containerRef}
          data-testid="kani-card-scene"
          className="kani-card-3d-scene is-settled-front w-full max-w-[342px] sm:max-w-[430px] md:max-w-[530px] lg:max-w-[580px] xl:max-w-[610px] 2xl:max-w-[640px] mx-auto cursor-grab active:cursor-grabbing select-none focus:outline-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handleMouseMoveHover}
          onPointerLeave={handleMouseLeaveHover}
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
            {/* FRONT FACE */}
            <div
              className="kani-card-3d-face relative overflow-hidden rounded-[22px] sm:rounded-[26px] md:rounded-[30px] lg:rounded-[32px] bg-[linear-gradient(145deg,#121214_0%,#09090B_52%,#040405_100%)] border border-[#C8A96B]/40 p-5 sm:p-7 md:p-9 lg:p-10 xl:p-11 min-h-[268px] sm:min-h-[368px] md:min-h-[444px] lg:min-h-[496px] xl:min-h-[520px] 2xl:min-h-[546px] flex flex-col justify-between"
              style={{
                boxShadow:
                  "0 0 0 1px rgba(212, 180, 117, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 38px 75px -12px rgba(0, 0, 0, 0.96)",
              }}
            >
              <div className="absolute top-0 inset-x-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#D4B475]/75 to-transparent" />
              <div className="absolute top-0 right-0 w-44 h-44 bg-[radial-gradient(circle,rgba(212,180,117,0.08)_0%,transparent_70%)] pointer-events-none" />

              <div className="absolute right-5 bottom-8 sm:right-7 sm:bottom-11 md:right-10 md:bottom-14 lg:right-12 lg:bottom-16 w-24 h-24 sm:w-32 sm:h-32 md:w-40 md:h-40 lg:w-44 lg:h-44 xl:w-48 xl:h-48 opacity-[0.14] pointer-events-none select-none overflow-hidden">
                <img
                  src={kanjiStamp}
                  alt=""
                  className="w-full h-full object-contain"
                  style={{ filter: "brightness(1.18) contrast(1.06)" }}
                />
              </div>

              {/* Card Header */}
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] pb-3 md:pb-4 lg:pb-5 relative z-10">
                <div className="flex items-center gap-2.5 sm:gap-3">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-full bg-gradient-to-br from-[#231F18] to-[#0A0907] border border-[#C8A96B]/50 flex items-center justify-center p-1.5 shadow-inner shrink-0">
                    <img src={kanjiStamp} alt="KANI" className="w-full h-full object-contain" />
                  </div>
                  <div>
                    <span className="font-serif font-bold text-xs sm:text-sm md:text-base lg:text-[17px] tracking-[0.2em] text-[#EDE8DF] block">
                      KANI
                    </span>
                    <span className="text-[7.5px] sm:text-[9px] md:text-[10px] lg:text-[11px] font-mono tracking-[0.3em] text-[#C8A96B] uppercase block">
                      PRIVATE MEMBERSHIP
                    </span>
                  </div>
                </div>

                <div
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full text-[9px] sm:text-[10.5px] md:text-xs lg:text-[12.5px] font-semibold tracking-[0.15em] border font-mono shrink-0"
                  style={{
                    backgroundColor: statusBadge.bg,
                    color: statusBadge.text,
                    borderColor: statusBadge.border,
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current opacity-85" />
                  {statusBadge.label}
                </div>
              </div>

              {/* Card Body */}
              <div className="my-auto py-3.5 md:py-6 relative z-10">
                <span className="text-[9.5px] sm:text-[10.5px] md:text-xs tracking-[0.25em] text-[#8E8B84] uppercase font-mono block mb-1.5">
                  TITULAR
                </span>
                <h1
                  className="text-[23px] sm:text-[32px] md:text-[39px] lg:text-[45px] xl:text-[49px] font-serif font-bold text-white tracking-tight leading-tight break-words"
                  style={{ fontFamily: "'Zen Antique', Georgia, serif" }}
                >
                  {card.client_name}
                </h1>
              </div>

              {/* Card Footer */}
              <div className="flex items-end justify-between pt-3 md:pt-4 lg:pt-5 border-t border-white/[0.08] relative z-10">
                <div className="space-y-0.5 md:space-y-1 font-mono">
                  <span className="text-[9.5px] sm:text-[10.5px] md:text-xs tracking-[0.22em] text-[#8E8B84] uppercase block">
                    BARBERO
                  </span>
                  <span className="text-[13.5px] sm:text-[15px] md:text-lg lg:text-[19px] text-[#F2F0EC] font-medium tracking-wide block">
                    {card.barber_name}
                  </span>
                </div>

                <div className="text-right space-y-0.5 md:space-y-1 font-mono">
                  <span className="text-[9.5px] sm:text-[10.5px] md:text-xs tracking-[0.22em] text-[#8E8B84] uppercase block">
                    VENCE
                  </span>
                  <span className="text-[13px] sm:text-[14.5px] md:text-[17px] lg:text-[18px] text-[#D4B475] font-semibold tracking-wider block">
                    {expiresLabel}
                  </span>
                </div>
              </div>
            </div>

            {/* BACK FACE */}
            <div
              className="kani-card-3d-face kani-card-3d-back relative overflow-hidden rounded-[22px] sm:rounded-[26px] md:rounded-[30px] lg:rounded-[32px] bg-[linear-gradient(145deg,#121214_0%,#09090B_52%,#040405_100%)] border border-[#C8A96B]/40 p-4 sm:p-6 md:p-8 lg:p-9 xl:p-10 min-h-[268px] sm:min-h-[368px] md:min-h-[444px] lg:min-h-[496px] xl:min-h-[520px] 2xl:min-h-[546px] flex flex-col justify-between"
              style={{
                boxShadow:
                  "0 0 0 1px rgba(212, 180, 117, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 38px 75px -12px rgba(0, 0, 0, 0.96)",
              }}
            >
              <div className="absolute top-0 inset-x-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#D4B475]/75 to-transparent" />

              <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5 md:pb-3.5 lg:pb-4">
                <span className="text-[9.5px] sm:text-xs md:text-[13px] lg:text-sm tracking-[0.20em] sm:tracking-[0.26em] text-[#D4B475] uppercase font-mono font-semibold">
                  BENEFICIOS DISPONIBLES
                </span>
                <span className="text-[9px] sm:text-xs md:text-[12.5px] lg:text-[13px] font-mono tracking-widest text-[#B5AEA0]">
                  {planLabel}
                </span>
              </div>

              {/* Sessions Grid */}
              <div className="my-auto py-2.5 sm:py-3.5 md:py-4 space-y-2 sm:space-y-3 md:space-y-3.5">
                <div className="flex items-center justify-between text-[11px] sm:text-xs md:text-sm lg:text-[14.5px] font-mono px-0.5">
                  <span className="text-[#A39E93]">Sesiones realizadas</span>
                  <span className="font-semibold text-white">
                    {consumedSessions} de {totalSessions}
                  </span>
                </div>

                <div
                  className={`grid gap-1.5 sm:gap-2 md:gap-2.5 ${
                    totalSessions === 10
                      ? "grid-cols-5"
                      : "grid-cols-4"
                  }`}
                >
                  {Array.from({ length: totalSessions }).map((_, idx) => {
                    const isConsumed = idx < consumedSessions;
                    return (
                      <div
                        key={idx}
                        className={`relative rounded-lg sm:rounded-xl md:rounded-2xl border p-2 sm:p-2.5 md:p-3 text-center transition-all ${
                          isConsumed
                            ? "bg-[#181410] border-[#382F24] text-[#7A7062]"
                            : "bg-[#090807] border-[#C8A96B]/50 text-[#F0D9A3] shadow-[0_0_12px_rgba(200,169,107,0.12)]"
                        }`}
                      >
                        <span className="block text-[8px] sm:text-[9px] md:text-[10px] font-mono uppercase tracking-wider mb-0.5">
                          #{idx + 1}
                        </span>
                        <span
                          className={`block text-[10px] sm:text-xs md:text-sm font-semibold ${
                            isConsumed ? "line-through text-[#635B4E]" : "text-white"
                          }`}
                        >
                          {isConsumed ? "Usada" : "Libre"}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {consumptionsList.length > 0 && (
                  <div className="pt-1.5 border-t border-white/[0.06] space-y-1 max-h-[85px] sm:max-h-[110px] md:max-h-[135px] overflow-y-auto font-mono text-[9px] sm:text-[10px] md:text-[11px]">
                    {consumptionsList.map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-[#8E8B84] px-0.5">
                        <span className="truncate">
                          {c.service_name} · {c.consumption_type === "NO_SHOW_DEDUCTION" ? "Inasistencia" : "Corte"}
                        </span>
                        <span className="shrink-0 text-[#6E6B65] ml-2">
                          {formatDateTimeShort(c.consumed_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Back Footer Actions */}
              <div className="flex items-center justify-between gap-2 pt-2.5 md:pt-3.5 lg:pt-4 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsQrModalOpen(true);
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
                  #{serialToken} · SOLO LECTURA
                </span>
              </div>
            </div>
          </div>
        </div>

        <p className="pt-3.5 pb-1 sm:pt-4 sm:pb-1.5 md:pt-5 md:pb-2 text-center text-[9.5px] sm:text-[10px] md:text-[11px] font-mono tracking-[0.22em] text-[#7A7263] uppercase">
          TOCÁ LA TARJETA PARA GIRARLA
        </p>
      </div>

      <footer className="w-full text-center text-[10px] sm:text-[10.5px] text-[#66625B] tracking-[0.2em] uppercase font-mono pt-6 pb-1 shrink-0">
        <p>© 2026 KANI Barber Studio</p>
      </footer>

      {/* QR MODAL */}
      {isQrModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/82 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto"
          onClick={() => setIsQrModalOpen(false)}
        >
          <div
            className="w-full max-w-[440px] sm:max-w-[440px] md:max-w-[470px] bg-gradient-to-b from-[#111113] to-[#060607] border border-[#C8A96B]/40 rounded-2xl sm:rounded-3xl p-5 sm:p-7 md:p-8 shadow-[0_28px_70px_rgba(0,0,0,0.96)] text-center space-y-3.5 sm:space-y-4 md:space-y-5 relative my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsQrModalOpen(false)}
              className="absolute top-3.5 right-3.5 sm:top-4 sm:right-4 p-2 rounded-full text-[#9B8A68] hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              aria-label="Cerrar ventana de verificación"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <div className="space-y-1.5 sm:space-y-2 px-6">
              <h2
                id="qr-modal-title"
                className="text-base sm:text-lg md:text-xl font-serif font-bold text-white tracking-tight"
              >
                Verificación en salón
              </h2>
              <p className="text-[11px] sm:text-xs text-[#9B8A68] leading-relaxed">
                Presentá este código QR ante tu barbero al momento del servicio para registrar el consumo.
              </p>
            </div>

            <div className="flex justify-center p-2.5 sm:p-3 bg-white rounded-2xl w-fit mx-auto shadow-[0_0_28px_rgba(200,169,107,0.22)]">
              <QRCodeCanvas value={verificationUrl} size={210} margin={2} />
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px] sm:text-xs font-mono text-left bg-[#0A0908] border border-[#241E17] rounded-xl p-3">
              <div className="truncate">
                <span className="text-[#867C68] block text-[8.5px] sm:text-[9.5px] tracking-[0.16em] mb-0.5">
                  TITULAR
                </span>
                <span className="text-white font-medium">{card.client_name}</span>
              </div>
              <div className="truncate">
                <span className="text-[#867C68] block text-[8.5px] sm:text-[9.5px] tracking-[0.16em] mb-0.5">
                  PROFESIONAL
                </span>
                <span className="text-[#E6E2DA]">{card.barber_name}</span>
              </div>
              <div>
                <span className="text-[#867C68] block text-[8.5px] sm:text-[9.5px] tracking-[0.16em] mb-0.5">
                  DISPONIBLES
                </span>
                <span className="text-[#D4B475] font-semibold">
                  {remainingSessions} de {totalSessions}
                </span>
              </div>
              <div>
                <span className="text-[#867C68] block text-[8.5px] sm:text-[9.5px] tracking-[0.16em] mb-0.5">
                  SERIAL
                </span>
                <span className="text-[#A39E93]">#{serialToken}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsQrModalOpen(false)}
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
