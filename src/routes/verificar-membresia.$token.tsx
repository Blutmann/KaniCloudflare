import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CircleCheck,
  CreditCard,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
} from "lucide-react";
import {
  formatMembershipStaffRole,
  MembershipStaffLoginModal,
  useMembershipStaffAuth,
} from "@/components/kani/membership-staff-auth";
import { isStaffOperator } from "@/lib/kani-permissions";
import {
  consumeMembershipSession,
  fetchMembershipForVerification,
  getPublicMembershipCard,
  type ClientMembershipRecord,
  type PublicMembershipCardResult,
} from "@/lib/kani-recurrences-memberships";

export const Route = createFileRoute("/verificar-membresia/$token")({
  head: () => ({
    meta: [
      { title: "Verificación de Membresía · KANI Barber Studio" },
      { name: "description", content: "Verificación oficial en salón de credencial de membresía KANI Barber Studio." },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: SalonMembershipVerificationView,
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

export function SalonMembershipVerificationView() {
  const { token } = Route.useParams();
  const staffAuth = useMembershipStaffAuth(`/verificar-membresia/${token}`);
  const staff = staffAuth.staff;

  const [loading, setLoading] = useState(true);
  const [publicCard, setPublicCard] = useState<PublicMembershipCardResult | null>(null);
  const [staffMembership, setStaffMembership] = useState<ClientMembershipRecord | null>(null);
  const [loadingStaffMembership, setLoadingStaffMembership] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedServiceName, setSelectedServiceName] = useState("");
  const [consumptionType, setConsumptionType] = useState<"SERVICE_COMPLETED" | "NO_SHOW_DEDUCTION">("SERVICE_COMPLETED");
  const [notes, setNotes] = useState("");
  const [isDeducting, setIsDeducting] = useState(false);
  const [actionSuccess, setActionSuccess] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastConsumed, setLastConsumed] = useState<any>(null);
  const deductLockRef = useRef(false);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.body.setAttribute("data-membership-page", "true");
      return () => {
        document.body.removeAttribute("data-membership-page");
      };
    }
  }, []);

  const loadPublicCard = useCallback(async () => {
    if (!token || token.trim().length < 16) {
      setError("INVALID_TOKEN");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const pubRes = await getPublicMembershipCard(token);
      if (!pubRes.found) {
        setPublicCard(null);
        setError(pubRes.error || "NOT_FOUND_OR_REVOKED");
        return;
      }
      setPublicCard(pubRes);
    } catch {
      setError("LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadPublicCard();
  }, [loadPublicCard]);

  useEffect(() => {
    let active = true;
    if (!staff || !token || token.trim().length < 16 || error || !publicCard?.found) {
      setStaffMembership(null);
      setLoadingStaffMembership(false);
      if (!staff) {
        setActionSuccess(false);
        setActionError(null);
        setLastConsumed(null);
      }
      return;
    }

    setLoadingStaffMembership(true);
    fetchMembershipForVerification(token, staff)
      .then((detailed) => {
        if (!active) return;
        setStaffMembership(detailed);
        const firstAvail = detailed?.items.find((i) => i.remainingQuantity > 0);
        if (firstAvail) {
          setSelectedServiceName((prev) => prev || firstAvail.serviceName);
        }
      })
      .catch(() => {
        if (!active) return;
        setStaffMembership(null);
      })
      .finally(() => {
        if (active) setLoadingStaffMembership(false);
      });

    return () => {
      active = false;
    };
  }, [staff, token, error, publicCard?.found]);

  const handleDeductSession = async () => {
    if (deductLockRef.current || isDeducting) return;
    if (!staff || !staffMembership) return;
    if (staffMembership.remainingSessions <= 0) {
      setActionError("Esta membresía no tiene sesiones disponibles.");
      return;
    }
    deductLockRef.current = true;
    setIsDeducting(true);
    setActionError(null);
    setActionSuccess(false);
    try {
      const res = await consumeMembershipSession(
        {
          membershipId: staffMembership.id,
          serviceName: selectedServiceName || undefined,
          consumptionType,
          notes: notes.trim() || undefined,
        },
        staff,
      );
      setStaffMembership(res.membership);
      setPublicCard((prev) =>
        prev
          ? {
              ...prev,
              remaining_sessions: res.remainingSessions,
              consumed_sessions: res.membership.consumedSessions,
              status: res.isExhausted ? "EXHAUSTED" : res.membership.status,
            }
          : prev,
      );
      setLastConsumed(res.consumption);
      setActionSuccess(true);
      setNotes("");
      const nextAvail = res.membership.items.find((i) => i.remainingQuantity > 0);
      if (nextAvail) {
        setSelectedServiceName(nextAvail.serviceName);
      }
    } catch (err: any) {
      setActionError(err?.message || "No se pudo registrar el consumo.");
    } finally {
      deductLockRef.current = false;
      setIsDeducting(false);
    }
  };

  if (loading) {
    return (
      <main className="kani-membership-pass min-h-[100dvh] w-full flex flex-col justify-center items-center py-6 px-4 bg-[#050505] text-[#EDECEC]">
        <div className="max-w-[360px] w-full bg-[#0D0B08] border border-[#231E17] rounded-2xl p-6 shadow-2xl text-center space-y-3">
          <Loader2 className="w-7 h-7 animate-spin text-[#C8A96B] mx-auto" />
          <p className="text-[10px] font-mono tracking-[0.24em] text-[#8C7A58] uppercase">
            KANI · VERIFICANDO CREDENCIAL
          </p>
        </div>
      </main>
    );
  }

  if (error || !publicCard || !publicCard.found) {
    return (
      <main className="kani-membership-pass min-h-[100dvh] w-full flex flex-col justify-between items-center py-6 px-4 bg-[#050505] text-[#EDECEC]">
        <div className="w-full max-w-[400px] my-auto bg-gradient-to-b from-[#14110E] to-[#0A0908] border border-[#282117] rounded-2xl p-6 shadow-2xl text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/25 flex items-center justify-center text-rose-400">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <span className="text-[9px] font-mono tracking-[0.25em] text-rose-400/80 uppercase block">
              VERIFICACIÓN RECHAZADA
            </span>
            <h1 className="text-base font-serif font-bold text-white tracking-tight">
              Credencial no válida o revocada
            </h1>
            <p className="text-xs text-[#8C857B] leading-relaxed">
              Este código QR no corresponde a una membresía vigente o fue sustituido por un nuevo enlace.
            </p>
          </div>
        </div>
        <footer className="text-center text-[10px] text-[#443E35] tracking-[0.2em] uppercase py-4 font-mono">
          <p>© 2026 KANI Barber Studio</p>
        </footer>
      </main>
    );
  }

  const totalSessions = staffMembership?.totalSessions ?? publicCard.total_sessions ?? publicCard.package_size ?? 4;
  const remainingSessions = staffMembership?.remainingSessions ?? publicCard.remaining_sessions ?? Math.max(0, totalSessions - (publicCard.consumed_sessions ?? 0));
  const rawStatus = staffMembership?.status ?? publicCard.status ?? "ACTIVE";
  const expiresAt = staffMembership ? staffMembership.expiresAt : publicCard.expires_at;
  const expiresLabel = expiresAt ? formatDateShort(expiresAt) : "SIN VENCIMIENTO";
  const clientName = staffMembership?.clientName || publicCard.client_name || "Titular";
  const barberName = staffMembership?.barberName || publicCard.barber_name || "Kani Barber Studio";

  const statusMap: Record<string, { label: string; badgeText: string; bg: string; text: string; border: string; validNow: boolean }> = {
    ACTIVE: {
      label: "Activa",
      badgeText: "CREDENCIAL VÁLIDA",
      bg: "rgba(16, 185, 129, 0.12)",
      text: "#10b981",
      border: "rgba(16, 185, 129, 0.35)",
      validNow: true,
    },
    PENDING_PAYMENT: {
      label: "Pendiente",
      badgeText: "PENDIENTE DE PAGO",
      bg: "rgba(245, 158, 11, 0.12)",
      text: "#f59e0b",
      border: "rgba(245, 158, 11, 0.35)",
      validNow: false,
    },
    EXHAUSTED: {
      label: "Agotada",
      badgeText: "SESIONES AGOTADAS",
      bg: "rgba(200, 169, 107, 0.12)",
      text: "#C8A96B",
      border: "rgba(200, 169, 107, 0.35)",
      validNow: false,
    },
    EXPIRED: {
      label: "Vencida",
      badgeText: "CREDENCIAL VENCIDA",
      bg: "rgba(239, 68, 68, 0.12)",
      text: "#ef4444",
      border: "rgba(239, 68, 68, 0.35)",
      validNow: false,
    },
    CANCELLED: {
      label: "Cancelada",
      badgeText: "MEMBRESÍA CANCELADA",
      bg: "rgba(156, 163, 175, 0.12)",
      text: "#9ca3af",
      border: "rgba(156, 163, 175, 0.35)",
      validNow: false,
    },
  };

  const statusConfig = statusMap[rawStatus] || statusMap.ACTIVE;
  const isOperatorStaff = !!(staff && staffMembership);
  const canDeduct = !!(isOperatorStaff && staffMembership && staffMembership.status === "ACTIVE" && staffMembership.remainingSessions > 0);
  const availableItems = staffMembership?.items.filter((i) => i.remainingQuantity > 0) || [];

  return (
    <main
      className="kani-membership-pass min-h-[100dvh] w-full flex flex-col justify-between items-center py-4 px-3.5 text-[#EDECEC] antialiased"
      style={{
        backgroundColor: "#050505",
        backgroundImage: `
          radial-gradient(ellipse at 50% 15%, rgba(200, 169, 107, 0.08) 0%, transparent 60%),
          linear-gradient(to bottom, rgba(5, 5, 5, 0.80) 0%, rgba(5, 5, 5, 0.94) 100%),
          url('/kani-background-desktop.webp')
        `,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="w-full max-w-[390px] sm:max-w-[420px] mx-auto my-auto space-y-2.5">
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[9px] font-mono tracking-[0.25em] text-[#8C7A58] uppercase">
            KANI · CONTROL SALÓN
          </span>
          <span className="text-[9px] font-mono tracking-widest text-[#554D40]">
            #{token.slice(0, 8).toUpperCase()}
          </span>
        </div>

        <div
          className="rounded-2xl border p-4 sm:p-5 space-y-3.5 shadow-2xl relative overflow-hidden"
          style={{
            backgroundColor: "#0D0B09",
            borderColor: statusConfig.border,
          }}
        >
          {/* Status Header */}
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#241E17]">
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold tracking-wider uppercase border"
              style={{
                backgroundColor: statusConfig.bg,
                color: statusConfig.text,
                borderColor: statusConfig.border,
              }}
            >
              {statusConfig.validNow ? (
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{statusConfig.badgeText}</span>
            </div>
            <span className="text-[9px] font-mono tracking-wider text-[#8C7A58] uppercase truncate">
              {totalSessions} SES. · {expiresLabel}
            </span>
          </div>

          {/* Client & Barber Info */}
          <div className="space-y-2">
            <div>
              <span className="text-[8px] font-mono tracking-[0.22em] text-[#6E6352] uppercase block">
                TITULAR
              </span>
              <h1
                className="text-lg sm:text-xl font-serif font-bold text-white tracking-tight leading-snug"
                style={{ fontFamily: "'Zen Antique', Georgia, serif" }}
              >
                {clientName}
              </h1>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl bg-[#090807] border border-[#1E1913] px-2.5 py-2">
                <span className="text-[7.5px] font-mono tracking-[0.18em] text-[#6E6352] uppercase block">
                  PROFESIONAL
                </span>
                <span className="text-xs font-medium text-[#E5DFD5] block mt-0.5 truncate">
                  {barberName}
                </span>
              </div>
              <div className="rounded-xl bg-[#090807] border border-[#1E1913] px-2.5 py-2">
                <span className="text-[7.5px] font-mono tracking-[0.18em] text-[#6E6352] uppercase block">
                  SESIONES RESTANTES
                </span>
                <span className="text-sm font-bold text-[#D4B475] block mt-0.5 font-mono">
                  {remainingSessions} de {totalSessions}
                </span>
              </div>
            </div>
          </div>

          {/* Operator Action Section */}
          {staff ? (
            <div className="pt-2 border-t border-[#241E17] space-y-2.5">
              <div
                data-testid="qr-staff-session"
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#090807] border border-[#241E17] px-3 py-2 text-[10px] font-mono text-[#A39E93]"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <UserCheck className="w-3.5 h-3.5 text-[#10b981] shrink-0" />
                  <span className="truncate text-[#E5DFD5] font-medium">{staff.profile.display_name}</span>
                  <span className="uppercase text-[9px] px-1.5 py-0.5 rounded bg-[#C8A96B]/15 border border-[#C8A96B]/30 text-[#E8D4A2] shrink-0">
                    {formatMembershipStaffRole(staff.profile.role)}
                  </span>
                  <span className="hidden sm:inline text-[9px] text-emerald-400/90 uppercase tracking-wider shrink-0">
                    · Sesión activa
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void staffAuth.handleSignOut()}
                  disabled={staffAuth.signingOut}
                  className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-[#2C251B] hover:border-[#C8A96B]/45 text-[#9B8A68] hover:text-white transition-colors cursor-pointer uppercase tracking-wider text-[9.5px] min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4B475] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090807] disabled:opacity-50"
                >
                  <LogOut className="w-3 h-3 shrink-0" />
                  <span>Cerrar sesión</span>
                </button>
              </div>

              {loadingStaffMembership && (
                <div className="flex items-center justify-center gap-2 py-2 text-[11px] font-mono text-[#8C7A58]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C8A96B]" />
                  <span>Cargando permisos de membresía...</span>
                </div>
              )}

              {!loadingStaffMembership && !staffMembership && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-[11px] text-amber-200/90 leading-relaxed">
                  Tu cuenta <strong>{formatMembershipStaffRole(staff.profile.role)}</strong> no tiene permisos para operar esta membresía (pertenece a otro profesional o requiere rol operador).
                </div>
              )}

              {actionSuccess && (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-[11px] text-emerald-300">
                  <CircleCheck className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>¡Sesión descontada correctamente! Restan {remainingSessions}.</span>
                </div>
              )}

              {actionError && (
                <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-[11px] text-rose-300">
                  {actionError}
                </div>
              )}

              {canDeduct && staffMembership && (
                <div className="pt-2 border-t border-[#241E17] space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      aria-label="Servicio a descontar"
                      value={selectedServiceName}
                      onChange={(e) => setSelectedServiceName(e.target.value)}
                      disabled={isDeducting}
                      className="w-full rounded-xl bg-[#090807] border border-[#2C251B] px-2.5 py-1.5 text-[11px] text-white focus:outline-none focus:border-[#C8A96B]"
                    >
                      {availableItems.map((item) => (
                        <option key={item.id || item.serviceName} value={item.serviceName}>
                          {item.serviceName} ({item.remainingQuantity} disp.)
                        </option>
                      ))}
                    </select>

                    <select
                      aria-label="Motivo de consumo"
                      value={consumptionType}
                      onChange={(e) => setConsumptionType(e.target.value as any)}
                      disabled={isDeducting}
                      className="w-full rounded-xl bg-[#090807] border border-[#2C251B] px-2.5 py-1.5 text-[11px] text-white focus:outline-none focus:border-[#C8A96B]"
                    >
                      <option value="SERVICE_COMPLETED">Servicio realizado</option>
                      <option value="NO_SHOW_DEDUCTION">Inasistencia</option>
                    </select>
                  </div>

                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={isDeducting}
                    placeholder="Nota breve (opcional)"
                    className="w-full rounded-xl bg-[#090807] border border-[#2C251B] px-2.5 py-1.5 text-[11px] text-white placeholder-[#5A5243] focus:outline-none focus:border-[#C8A96B]"
                  />

                  <button
                    type="button"
                    onClick={handleDeductSession}
                    disabled={isDeducting}
                    className="w-full min-h-[42px] py-2 px-3 rounded-xl bg-[#6B1D2F] hover:bg-[#8B263E] text-white font-mono text-[11px] font-semibold tracking-wider uppercase transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg disabled:opacity-50"
                  >
                    {isDeducting ? (
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                    ) : (
                      <CircleCheck className="w-4 h-4 text-[#D4B475]" />
                    )}
                    <span>{isDeducting ? "Registrando..." : "Descontar sesión ahora"}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="pt-2.5 border-t border-[#241E17] text-center space-y-2.5">
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#A39E93]">
                <Lock className="w-3.5 h-3.5 text-[#C8A96B]" />
                <span>Vista pública de verificación</span>
              </div>
              <p className="text-[10.5px] text-[#8C8270] leading-relaxed">
                Para descontar sesiones desde este escáner, iniciá sesión con tu cuenta interna.
              </p>
              <button
                type="button"
                onClick={staffAuth.openLoginModal}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-[#18140E] hover:bg-[#241D14] border border-[#D4B475]/55 hover:border-[#F0D9A3] text-[#F0D9A3] hover:text-white font-mono text-[11px] font-semibold tracking-[0.16em] uppercase transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg"
              >
                <LogIn className="w-4 h-4 text-[#D4B475] shrink-0" />
                <span>Iniciar sesión</span>
              </button>
            </div>
          )}

          {/* Quick Links */}
          <div
            className={`pt-2 border-t border-[#241E17] ${
              staff && isStaffOperator(staff.profile.role) && staffMembership ? "grid grid-cols-2 gap-2" : "flex"
            }`}
          >
            {staff && isStaffOperator(staff.profile.role) && staffMembership && (
              <Link
                to="/panel-administracion/membresias"
                search={{ membershipId: staffMembership.id } as any}
                aria-label="Gestionar membresía en Panel Admin"
                className="py-2 px-2.5 rounded-xl bg-[#18140E] hover:bg-[#231D14] border border-[#C8A96B]/40 text-[#E8D4A2] font-mono text-[9.5px] tracking-wider uppercase flex items-center justify-center gap-1 transition-colors"
              >
                <span>Panel Admin</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
              </Link>
            )}

            <Link
              to="/membresia/$token"
              params={{ token }}
              className="w-full py-2 px-2.5 rounded-xl bg-[#0D0B09] hover:bg-[#15120E] border border-[#262018] text-[#9A8E78] hover:text-[#E8D4A2] font-mono text-[9.5px] tracking-wider uppercase flex items-center justify-center gap-1.5 transition-colors"
            >
              <CreditCard className="w-3 h-3 shrink-0" />
              <span>Ver credencial digital</span>
            </Link>
          </div>
        </div>
      </div>

      <footer className="text-center text-[9.5px] text-[#443E35] tracking-[0.2em] uppercase pt-3 pb-1 font-mono">
        <p>© 2026 KANI Barber Studio</p>
      </footer>

      <MembershipStaffLoginModal
        isOpen={staffAuth.isLoginOpen}
        onClose={staffAuth.closeLoginModal}
        onAuthenticated={staffAuth.handleAuthenticated}
        authError={staffAuth.authError}
        subtitle="Iniciá sesión como ADMIN, JEFE o BARBER para verificar y operar esta membresía."
      />
    </main>
  );
}
