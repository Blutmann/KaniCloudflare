import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart2,
  Check,
  CheckCircle2,
  Clock,
  DollarSign,
  Link2,
  Receipt,
  RotateCcw,
  Scissors,
  Trash2,
  User,
  UserCheck,
  Wallet,
  X,
} from "lucide-react";
import {
  dateRangeForStatisticsPreset,
  getStatisticsPresetLabels,
  statisticsPresets,
  type StatisticsDatePreset,
} from "@/lib/kani-statistics";
import { addCalendarDays } from "@/lib/kani-mobile-appointments";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { readRealAppointments, type RealAppointment } from "@/lib/kani-appointments";
import {
  businessTimeNow,
  fetchServicePayments,
  findCandidateAppointments,
  recordServicePayment,
  STANDARD_SERVICE_PRICES,
  validatePaymentInput,
  type CandidateAppointmentMatch,
  type PaymentMethod,
  type RecordServicePaymentInput,
  type ServicePayment,
  type ServicePaymentFilters,
  type ServicePaymentType,
} from "@/lib/kani-payments";
import { businessDateToday } from "@/lib/kani-mobile-appointments";
import { money } from "@/lib/kani-model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AdminPayments() {
  const staff = useAdminStaff();
  const isAdmin = staff.profile.role === "ADMIN";

  // Almacén de turnos y registros
  const [appointments, setAppointments] = useState<RealAppointment[]>([]);
  const [payments, setPayments] = useState<ServicePayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filtros aplicados a datos persistidos
  const todayStr = useMemo(() => businessDateToday(), []);
  const [filterPeriod, setFilterPeriod] = useState<StatisticsDatePreset>("TODAY");
  const [filterDate, setFilterDate] = useState<string>(todayStr);
  const [filterBarberId, setFilterBarberId] = useState<string>("ALL");
  const [filterServiceName, setFilterServiceName] = useState<"ALL" | ServicePaymentType>("ALL");
  const [filterOtherDetail, setFilterOtherDetail] = useState<string>("");

  const presetLabels = useMemo(() => getStatisticsPresetLabels(todayStr), [todayStr]);

  const handlePeriodChange = (newPreset: StatisticsDatePreset) => {
    setFilterPeriod(newPreset);
    if (newPreset === "TODAY") {
      setFilterDate(todayStr);
    } else if (newPreset === "YESTERDAY") {
      setFilterDate(addCalendarDays(todayStr, -1));
    }
  };

  const handleSpecificDateChange = (newDate: string) => {
    setFilterDate(newDate);
    setFilterPeriod("SPECIFIC");
  };

  // Estado del formulario de nuevo cobro
  const defaultBarberId = isAdmin
    ? staff.barbers[0]?.id || ""
    : staff.profile.barber_id || "";

  const [formBarberId, setFormBarberId] = useState<string>(defaultBarberId);
  const [formDate, setFormDate] = useState<string>(todayStr);
  const [formTime, setFormTime] = useState<string>(businessTimeNow());
  const [formServiceName, setFormServiceName] = useState<ServicePaymentType>("Corte");
  const [formOtherDetail, setFormOtherDetail] = useState<string>("");
  const [formPriceArs, setFormPriceArs] = useState<number>(STANDARD_SERVICE_PRICES["Corte"]);
  const [formDiscountArs, setFormDiscountArs] = useState<number | string>(0);
  const [formClientName, setFormClientName] = useState<string>("");
  const [formClientContact, setFormClientContact] = useState<string>("");
  const [formPaymentMethod, setFormPaymentMethod] = useState<PaymentMethod>("Efectivo");
  const [formOnlineDepositPaid, setFormOnlineDepositPaid] = useState<boolean>(false);
  const [linkedAppointment, setLinkedAppointment] = useState<RealAppointment | null>(null);
  const [showCandidateSearch, setShowCandidateSearch] = useState<boolean>(false);

  // Inicializar barberId si staff cambia
  useEffect(() => {
    if (!formBarberId && defaultBarberId) {
      setFormBarberId(defaultBarberId);
    }
  }, [defaultBarberId, formBarberId]);

  // Cargar datos (turnos y registros de cobros)
  async function loadData() {
    setIsLoading(true);
    try {
      const [aptsData, paymentsData] = await Promise.all([
        readRealAppointments().catch((e) => {
          console.warn("[AdminPayments] No se pudieron cargar turnos:", e);
          return [] as RealAppointment[];
        }),
        (() => {
          const periodRange = filterPeriod !== "SPECIFIC"
            ? dateRangeForStatisticsPreset(filterPeriod, todayStr, filterDate)
            : null;

          const queryFilters: ServicePaymentFilters = {
            date: filterPeriod === "SPECIFIC" ? (filterDate || undefined) : undefined,
            startDate: periodRange ? periodRange.start : undefined,
            endDate: periodRange ? periodRange.end : undefined,
            barberId: filterBarberId,
            serviceName: filterServiceName,
            otherDetail: filterOtherDetail,
          };
          return fetchServicePayments(queryFilters, staff);
        })(),
      ]);
      setAppointments(aptsData);
      setPayments(paymentsData);
    } catch (err: any) {
      console.error("[AdminPayments] Error al cargar pagos:", err);
      const detail = err?.message || err?.details || err?.hint || (typeof err === "string" ? err : "");
      setErrorMessage(detail ? `No se pudieron cargar los registros de cobro: ${detail}` : "No se pudieron cargar los registros de cobro.");
    } finally {
      setIsLoading(false);
    }
  }

  // Recargar al cambiar filtros o disparar actualización general
  useEffect(() => {
    void loadData();
  }, [filterPeriod, filterDate, filterBarberId, filterServiceName, filterOtherDetail, staff.refreshCount]);

  // Turnos ya pagados para evitar duplicación
  const alreadyPaidAppointmentIds = useMemo(() => {
    return new Set(payments.map((p) => p.appointmentId).filter(Boolean) as string[]);
  }, [payments]);

  // Estadísticas calculadas en tiempo real sobre los cobros filtrados
  const paymentStats = useMemo(() => {
    const totalCollected = payments.reduce((sum, p) => sum + (p.finalAmountArs || 0), 0);
    const servicesCount = payments.length;
    const averageTicket = servicesCount > 0 ? Math.round(totalCollected / servicesCount) : 0;

    // 1. Desglose por método de pago (valores reales en service_payments)
    const byMethodMap = new Map<string, { total: number; count: number }>();
    byMethodMap.set("Efectivo", { total: 0, count: 0 });
    byMethodMap.set("Transferencia", { total: 0, count: 0 });

    for (const p of payments) {
      const method = p.paymentMethod || "Otros";
      const current = byMethodMap.get(method) || { total: 0, count: 0 };
      current.total += (p.finalAmountArs || 0);
      current.count += 1;
      byMethodMap.set(method, current);
    }

    const byMethod = Array.from(byMethodMap.entries())
      .filter(([_, data]) => servicesCount === 0 || data.count > 0 || data.total > 0)
      .map(([method, data]) => ({
        method,
        total: data.total,
        count: data.count,
        percentage: totalCollected > 0 ? (data.total / totalCollected) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);

    // 2. Desglose por servicio
    const byServiceMap = new Map<string, { total: number; count: number }>();
    for (const p of payments) {
      const sName = p.serviceName === "Otros" && p.serviceOtherDetail
        ? `${p.serviceOtherDetail} (Otros)`
        : p.serviceName;
      const current = byServiceMap.get(sName) || { total: 0, count: 0 };
      current.total += (p.finalAmountArs || 0);
      current.count += 1;
      byServiceMap.set(sName, current);
    }

    const byService = Array.from(byServiceMap.entries())
      .map(([service, data]) => ({
        service,
        total: data.total,
        count: data.count,
        percentage: totalCollected > 0 ? (data.total / totalCollected) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);

    // 3. Desglose por barbero
    const byBarberMap = new Map<string, { total: number; count: number }>();
    for (const p of payments) {
      const bName = p.barberName || "Barbero";
      const current = byBarberMap.get(bName) || { total: 0, count: 0 };
      current.total += (p.finalAmountArs || 0);
      current.count += 1;
      byBarberMap.set(bName, current);
    }

    const byBarber = Array.from(byBarberMap.entries())
      .map(([barber, data]) => ({
        barber,
        total: data.total,
        count: data.count,
        percentage: totalCollected > 0 ? (data.total / totalCollected) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);

    return {
      totalCollected,
      servicesCount,
      averageTicket,
      byMethod,
      byService,
      byBarber,
    };
  }, [payments]);

  // Turnos candidatos para vinculación
  const candidateMatches = useMemo(() => {
    return findCandidateAppointments(
      {
        date: formDate,
        time: formTime,
        clientName: formClientName,
        barberId: formBarberId,
      },
      appointments,
      alreadyPaidAppointmentIds,
    );
  }, [formDate, formTime, formClientName, formBarberId, appointments, alreadyPaidAppointmentIds]);

  // Manejo de cambio de servicio en formulario
  function handleServiceChange(service: ServicePaymentType) {
    setFormServiceName(service);
    if (service === "Otros") {
      setFormPriceArs(0);
    } else {
      setFormPriceArs(STANDARD_SERVICE_PRICES[service]);
      setFormOtherDetail("");
    }
  }

  // Vincular un turno candidato
  function handleLinkAppointment(match: CandidateAppointmentMatch) {
    const apt = match.appointment;
    setLinkedAppointment(apt);

    // Autocompletar datos si están vacíos
    if (!formClientName.trim() && apt.name) {
      setFormClientName(apt.name);
    }
    if (!formClientContact.trim() && (apt.phone || apt.email)) {
      setFormClientContact(apt.phone || apt.email);
    }

    // Adaptar servicio al del turno si coincide
    if (apt.service === "corte") {
      setFormServiceName("Corte");
      setFormPriceArs(STANDARD_SERVICE_PRICES["Corte"]);
    } else if (apt.service === "corte-barba") {
      setFormServiceName("Corte y barba");
      setFormPriceArs(STANDARD_SERVICE_PRICES["Corte y barba"]);
    } else if (apt.service === "barba") {
      setFormServiceName("Barba");
      setFormPriceArs(STANDARD_SERVICE_PRICES["Barba"]);
    }

    // Seña abonada online reflejada del turno real
    setFormOnlineDepositPaid(Boolean(apt.depositPaid));
    setShowCandidateSearch(false);
  }

  // Desvincular turno
  function handleUnlinkAppointment() {
    setLinkedAppointment(null);
    setFormOnlineDepositPaid(false);
  }

  // Cálculos económicos en vivo
  const numericDiscount = Math.max(0, Number(formDiscountArs) || 0);
  const totalCalculated = Math.max(0, formPriceArs - numericDiscount);
  const depositDeduction =
    linkedAppointment && linkedAppointment.depositPaid && formOnlineDepositPaid
      ? linkedAppointment.depositAmountArs || 5000
      : 0;
  const balanceToCollectAtShop = Math.max(0, totalCalculated - depositDeduction);

  // Reiniciar formulario
  function handleResetForm() {
    setFormDate(businessDateToday());
    setFormTime(businessTimeNow());
    setFormServiceName("Corte");
    setFormPriceArs(STANDARD_SERVICE_PRICES["Corte"]);
    setFormOtherDetail("");
    setFormDiscountArs(0);
    setFormClientName("");
    setFormClientContact("");
    setFormPaymentMethod("Efectivo");
    setFormOnlineDepositPaid(false);
    setLinkedAppointment(null);
    setShowCandidateSearch(false);
    setErrorMessage(null);
  }

  // Enviar formulario
  async function handleSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const input: RecordServicePaymentInput = {
      barberId: formBarberId,
      serviceName: formServiceName,
      serviceOtherDetail: formServiceName === "Otros" ? formOtherDetail.trim() : undefined,
      servicePriceArs: formPriceArs,
      discountArs: numericDiscount,
      paymentDate: formDate,
      paymentTime: formTime,
      paymentMethod: formPaymentMethod,
      onlineDepositPaid: formOnlineDepositPaid,
      clientName: formClientName.trim() || undefined,
      clientContact: formClientContact.trim() || undefined,
      appointmentId: linkedAppointment?.id || undefined,
    };

    const validation = validatePaymentInput(input, { appointment: linkedAppointment });
    if (!validation.valid) {
      setErrorMessage(validation.error || "Revisá los datos ingresados.");
      return;
    }

    setIsSubmitting(true);
    try {
      const persisted = await recordServicePayment(input, staff, linkedAppointment);
      setSuccessMessage("Cobro de servicio registrado exitosamente.");
      setPayments(prev => [persisted, ...prev.filter(p => p.id !== persisted.id)]);
      handleResetForm();
      // Sincronizar filtros si la fecha o barbero filtrado no coinciden
      if (filterDate && filterDate !== persisted.paymentDate) {
        setFilterDate(persisted.paymentDate);
      }
      if (filterBarberId !== 'ALL' && filterBarberId !== persisted.barberId) {
        setFilterBarberId('ALL');
      }
      await loadData();
    } catch (err: any) {
      console.error("[AdminPayments] Error al guardar cobro:", err);
      setErrorMessage(err.message || "No se pudo guardar el registro de cobro.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="site-container admin-schedule-page">
      <div className="admin-schedule-shell">
        {/* Notificaciones de éxito o error */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-xs flex items-center gap-2" role="alert">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="ml-auto text-destructive hover:opacity-80"
              aria-label="Cerrar error"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {successMessage && (
          <div className="mb-4 p-3 rounded-lg border border-success/40 bg-success/10 text-success text-xs flex items-center gap-2" role="status">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
            <button
              type="button"
              onClick={() => setSuccessMessage(null)}
              className="ml-auto text-success hover:opacity-80"
              aria-label="Cerrar notificación"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 1. Formulario de registro rápido */}
        <section
          className="p-3.5 sm:p-5 rounded-xl border border-border bg-surface shadow-xs mb-4 sm:mb-6"
          aria-label="Registrar cobro de servicio"
        >
          {linkedAppointment && (
            <div className="flex items-center justify-between pb-2.5 sm:pb-3 mb-3 sm:mb-4 border-b border-border/60">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                <Link2 className="w-3.5 h-3.5" />
                Turno #{linkedAppointment.requestNumber} vinculado
                <button
                  type="button"
                  onClick={handleUnlinkAppointment}
                  className="hover:text-destructive ml-1"
                  title="Desvincular turno"
                  aria-label="Desvincular turno"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            </div>
          )}

          <form onSubmit={handleSubmitForm} className="space-y-3 sm:space-y-4">
            <div className={`admin-payment-form-grid ${formServiceName === "Otros" ? "has-other" : ""}`}>
              {/* Fecha */}
              <div className="payment-field-fecha">
                <label htmlFor="form-date" className="block text-xs font-medium text-muted-foreground mb-1">
                  Fecha *
                </label>
                <input
                  id="form-date"
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="select-control w-full h-[40px] sm:h-[42px] px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                  required
                />
              </div>

              {/* Horario */}
              <div className="payment-field-horario">
                <label htmlFor="form-time" className="block text-xs font-medium text-muted-foreground mb-1">
                  Horario *
                </label>
                <input
                  id="form-time"
                  type="time"
                  value={formTime}
                  onChange={(e) => setFormTime(e.target.value)}
                  className="select-control w-full h-[40px] sm:h-[42px] px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                  required
                />
              </div>

              {/* Barbero */}
              <div className="payment-field-barbero">
                {isAdmin ? (
                  <>
                    <label htmlFor="form-barber" className="block text-xs font-medium text-muted-foreground mb-1">
                      Barbero *
                    </label>
                    <select
                      id="form-barber"
                      value={formBarberId}
                      onChange={(e) => setFormBarberId(e.target.value)}
                      className="select-control w-full h-[40px] sm:h-[42px] px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                      required
                    >
                      {staff.barbers.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Barbero
                    </label>
                    <output className="select-control w-full h-[40px] sm:h-[42px] px-3 text-xs bg-muted/40 border border-border rounded-lg text-muted-foreground flex items-center">
                      {staff.profile.display_name}
                    </output>
                  </>
                )}
              </div>

              {/* Servicio */}
              <div className="payment-field-servicio">
                <label htmlFor="form-service" className="block text-xs font-medium text-muted-foreground mb-1">
                  Servicio *
                </label>
                <select
                  id="form-service"
                  value={formServiceName}
                  onChange={(e) => handleServiceChange(e.target.value as ServicePaymentType)}
                  className="select-control w-full h-[40px] sm:h-[42px] px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 font-medium"
                >
                  <option value="Corte">Corte</option>
                  <option value="Corte y barba">Corte y barba</option>
                  <option value="Barba">Barba</option>
                  <option value="Otros">Otros (Personalizado)</option>
                </select>
              </div>

              {/* Detalle del servicio (solo si Otros) */}
              {formServiceName === "Otros" && (
                <div className="payment-field-detalle">
                  <label htmlFor="form-other-detail" className="block text-xs font-medium text-muted-foreground mb-1">
                    Detalle del servicio *
                  </label>
                  <input
                    id="form-other-detail"
                    type="text"
                    placeholder="Ej: Lavado, Color, Peinado, Venta..."
                    value={formOtherDetail}
                    onChange={(e) => setFormOtherDetail(e.target.value)}
                    className="select-control w-full h-[40px] sm:h-[42px] px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                    required
                  />
                </div>
              )}

              {/* Importe */}
              <div className="payment-field-importe">
                {formServiceName === "Otros" ? (
                  <>
                    <label htmlFor="form-price" className="block text-xs font-medium text-muted-foreground mb-1">
                      Importe ($ ARS) *
                    </label>
                    <input
                      id="form-price"
                      type="number"
                      min="1"
                      step="100"
                      placeholder="0"
                      value={formPriceArs || ""}
                      onChange={(e) => setFormPriceArs(Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="select-control w-full h-[40px] sm:h-[42px] px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                      required
                    />
                  </>
                ) : (
                  <>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Importe oficial
                    </label>
                    <output className="select-control w-full h-[40px] sm:h-[42px] px-3 text-xs bg-muted/30 border border-border rounded-lg text-foreground font-semibold flex items-center">
                      {money(formPriceArs)}
                    </output>
                  </>
                )}
              </div>

              {/* Descuento */}
              <div className="payment-field-descuento">
                <label htmlFor="form-discount" className="block text-xs font-medium text-muted-foreground mb-1">
                  Descuento ($ ARS opcional)
                </label>
                <input
                  id="form-discount"
                  type="number"
                  min="0"
                  max={formPriceArs || 999999}
                  step="100"
                  value={formDiscountArs === 0 ? "0" : formDiscountArs}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormDiscountArs(val === "" ? "" : Math.max(0, parseInt(val, 10) || 0));
                  }}
                  className="select-control w-full h-[40px] sm:h-[42px] px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                />
              </div>

              {/* Método de pago */}
              <div className="payment-field-metodo">
                <label htmlFor="form-payment-method" className="block text-xs font-medium text-muted-foreground mb-1">
                  Método de pago *
                </label>
                <select
                  id="form-payment-method"
                  value={formPaymentMethod}
                  onChange={(e) => setFormPaymentMethod(e.target.value as PaymentMethod)}
                  className="select-control w-full h-[40px] sm:h-[42px] px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 font-medium"
                >
                  <option value="Efectivo">Efectivo</option>
                  <option value="Transferencia">Transferencia</option>
                </select>
              </div>

              {/* Seña abonada */}
              <div className="payment-field-sena">
                <label htmlFor="form-online-deposit" className="block text-xs font-medium text-muted-foreground mb-1">
                  Seña abonada
                </label>
                <select
                  id="form-online-deposit"
                  value={formOnlineDepositPaid ? "SI" : "NO"}
                  onChange={(e) => {
                    const isYes = e.target.value === "SI";
                    if (isYes && (!linkedAppointment || !linkedAppointment.depositPaid)) {
                      setErrorMessage(
                        "Solo podés marcar 'Sí' si vinculás un turno con seña efectivamente acreditada en el sistema.",
                      );
                      setFormOnlineDepositPaid(false);
                      return;
                    }
                    setFormOnlineDepositPaid(isYes);
                  }}
                  className="select-control w-full h-[40px] sm:h-[42px] px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                >
                  <option value="NO">No</option>
                  <option value="SI">Sí (Verificado)</option>
                </select>
              </div>

              {/* Cliente (opcional) */}
              <div className="payment-field-cliente">
                <label htmlFor="form-client-name" className="block text-xs font-medium text-muted-foreground mb-1">
                  Cliente (opcional)
                </label>
                <input
                  id="form-client-name"
                  type="text"
                  placeholder="Nombre y apellido"
                  value={formClientName}
                  onChange={(e) => setFormClientName(e.target.value)}
                  className="select-control w-full h-[40px] sm:h-[42px] px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                />
              </div>

              {/* Contacto del cliente (opcional) */}
              <div className="payment-field-contacto">
                <label htmlFor="form-client-contact" className="block text-xs font-medium text-muted-foreground mb-1">
                  Contacto del cliente (opcional)
                </label>
                <input
                  id="form-client-contact"
                  type="text"
                  placeholder="Celular o email"
                  value={formClientContact}
                  onChange={(e) => setFormClientContact(e.target.value)}
                  className="select-control w-full h-[40px] sm:h-[42px] px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                />
              </div>
            </div>

            {/* Panel de coincidencias candidatas de turnos */}
            <div className="pt-1">
              {!linkedAppointment && candidateMatches.length > 0 && (
                <div className="p-3 rounded-lg border border-primary/20 bg-primary/5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-primary" />
                      Posibles turnos para vincular ({candidateMatches.length}):
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowCandidateSearch(!showCandidateSearch)}
                      className="text-xs text-primary underline hover:text-primary/80"
                    >
                      {showCandidateSearch ? "Ocultar candidatos" : "Ver candidatos"}
                    </button>
                  </div>

                  {showCandidateSearch && (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {candidateMatches.map(({ appointment, matchReasons }) => (
                        <div
                          key={appointment.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-md bg-background border border-border text-xs"
                        >
                          <div>
                            <span className="font-semibold text-foreground">
                              #{appointment.requestNumber} - {appointment.time} hs
                            </span>
                            <span className="mx-1 text-muted-foreground">·</span>
                            <span className="text-foreground">{appointment.name}</span>
                            <span className="mx-1 text-muted-foreground">·</span>
                            <span className="text-muted-foreground">{appointment.serviceName || appointment.service}</span>
                            {isAdmin && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
                                {appointment.barber}
                              </span>
                            )}
                            {appointment.depositPaid && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-success/15 text-success font-medium">
                                Seña acreditada (${(appointment.depositAmountArs || 5000).toLocaleString("es-AR")})
                              </span>
                            )}
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {matchReasons.join(", ")}
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => handleLinkAppointment({ appointment, score: 0, matchReasons })}
                            className="h-7 text-xs shrink-0 self-end sm:self-auto"
                          >
                            Vincular
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Resumen del cobro final */}
            <div className="p-3.5 rounded-lg border border-border/80 bg-background/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs space-y-0.5">
                <div className="text-muted-foreground">
                  Servicio: <span className="font-medium text-foreground">{money(formPriceArs)}</span>
                  {numericDiscount > 0 && (
                    <>
                      {" "}
                      − Descuento:{" "}
                      <span className="font-medium text-destructive">−{money(numericDiscount)}</span>
                    </>
                  )}
                  {depositDeduction > 0 && (
                    <>
                      {" "}
                      − Seña online previa:{" "}
                      <span className="font-medium text-success">−{money(depositDeduction)}</span>
                    </>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Método: <span className="font-medium text-foreground">{formPaymentMethod}</span>
                </div>
              </div>

              <div className="text-right">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                  {depositDeduction > 0 ? "A cobrar en local" : "Total final calculado"}
                </div>
                <div className="text-lg font-bold text-foreground">
                  {money(balanceToCollectAtShop)}
                </div>
              </div>
            </div>

            {/* Botones de acción */}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetForm}
                disabled={isSubmitting}
                className="h-9 px-4 text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting}
                className="h-9 px-5 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {isSubmitting ? "Guardando…" : "Guardar cobro"}
              </Button>
            </div>
          </form>
        </section>

        {/* 2. Filtros de historial persistido */}
        <section
          className="p-3.5 sm:p-4 rounded-xl border border-border bg-surface shadow-xs mb-4"
          aria-label="Filtros de registros de pagos"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* 1. Filtro Período */}
            <div>
              <label htmlFor="filter-period" className="block text-xs font-medium text-muted-foreground mb-1">
                Período
              </label>
              <select
                id="filter-period"
                value={filterPeriod}
                onChange={(e) => handlePeriodChange(e.target.value as StatisticsDatePreset)}
                className="select-control w-full h-9 px-2.5 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
              >
                {statisticsPresets.map((preset) => (
                  <option key={preset} value={preset}>
                    {presetLabels[preset]}
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Filtro Fecha específica */}
            <div>
              <label htmlFor="filter-date" className="block text-xs font-medium text-muted-foreground mb-1">
                Fecha específica
              </label>
              <input
                id="filter-date"
                type="date"
                value={filterDate}
                onChange={(e) => handleSpecificDateChange(e.target.value)}
                className={`select-control w-full h-9 px-2.5 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 ${
                  filterPeriod !== "SPECIFIC" ? "opacity-75" : ""
                }`}
                title={
                  filterPeriod !== "SPECIFIC"
                    ? `Filtro por período activo (${presetLabels[filterPeriod]}). Elegí una fecha para filtrar un día puntual.`
                    : "Filtrando por fecha específica"
                }
              />
            </div>

            {/* 3. Filtro Barbero */}
            <div>
              <label htmlFor="filter-barber" className="block text-xs font-medium text-muted-foreground mb-1">
                Barbero
              </label>
              {isAdmin ? (
                <select
                  id="filter-barber"
                  value={filterBarberId}
                  onChange={(e) => setFilterBarberId(e.target.value)}
                  className="select-control w-full h-9 px-2.5 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                >
                  <option value="ALL">Todos los barberos</option>
                  {staff.barbers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="select-control w-full h-9 px-2.5 text-xs bg-muted/40 border border-border rounded-lg text-muted-foreground flex items-center">
                  {staff.profile.display_name || "Mi cuenta"}
                </div>
              )}
            </div>

            {/* 4. Filtro Servicio */}
            <div>
              <label htmlFor="filter-service" className="block text-xs font-medium text-muted-foreground mb-1">
                Servicio
              </label>
              <select
                id="filter-service"
                value={filterServiceName}
                onChange={(e) => setFilterServiceName(e.target.value as any)}
                className="select-control w-full h-9 px-2.5 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
              >
                <option value="ALL">Todos</option>
                <option value="Corte">Corte</option>
                <option value="Corte y barba">Corte y barba</option>
                <option value="Barba">Barba</option>
                <option value="Otros">Otros</option>
              </select>
            </div>

            {/* Filtro Detalle de Otros si aplica */}
            {filterServiceName === "Otros" && (
              <div className="sm:col-span-2 lg:col-span-4">
                <label htmlFor="filter-detail" className="block text-xs font-medium text-muted-foreground mb-1">
                  Detalle del servicio
                </label>
                <input
                  id="filter-detail"
                  type="text"
                  placeholder="Buscar detalle…"
                  value={filterOtherDetail}
                  onChange={(e) => setFilterOtherDetail(e.target.value)}
                  className="select-control w-full h-9 px-2.5 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                />
              </div>
            )}
          </div>
        </section>

        {/* 3. Listado de servicios registrados */}
        <section
          className="rounded-xl border border-border bg-surface shadow-xs overflow-hidden"
          aria-label="Listado de servicios registrados"
        >
          <div className="px-4 py-3 border-b border-border/80 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Servicios registrados ({payments.length})
            </h2>
            {isLoading && <span className="text-xs text-muted-foreground animate-pulse">Cargando…</span>}
          </div>

          {payments.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              {isLoading ? "Cargando cobros registrados…" : "No hay servicios registrados para los filtros seleccionados."}
            </div>
          ) : (
            <>
              {/* Vista desktop: tabla con 6 columnas independientes */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs text-foreground">
                  <thead className="bg-muted/40 border-b border-border font-medium text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-2.5 px-4 font-medium text-left">Hora</th>
                      <th scope="col" className="py-2.5 px-4 font-medium text-left">Servicio</th>
                      <th scope="col" className="py-2.5 px-4 font-medium text-left">Barbero</th>
                      <th scope="col" className="py-2.5 px-4 font-medium text-left">Cliente</th>
                      <th scope="col" className="py-2.5 px-4 font-medium text-right">Importe</th>
                      <th scope="col" className="py-2.5 px-4 font-medium text-left">Método de pago</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {payments.map((payment) => (
                      <tr key={payment.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4 font-medium whitespace-nowrap text-left">
                          {payment.paymentTime} hs
                          {payment.paymentDate !== todayStr && (
                            <span className="block text-[10px] text-muted-foreground font-normal">
                              {payment.paymentDate}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-left">
                          <div className="font-semibold text-foreground">
                            {payment.serviceName === "Otros" && payment.serviceOtherDetail
                              ? `${payment.serviceOtherDetail} (Otros)`
                              : payment.serviceName}
                          </div>
                          {payment.discountArs > 0 && (
                            <div className="text-[10px] text-destructive">
                              Desc: −{money(payment.discountArs)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 font-medium text-foreground text-left">
                          {payment.barberName}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground text-left">
                          {payment.clientName ? (
                            <span className="text-foreground font-medium">{payment.clientName}</span>
                          ) : (
                            <span className="text-muted-foreground/80">—</span>
                          )}
                          {payment.clientContact && (
                            <span className="block text-[10px] text-muted-foreground">
                              {payment.clientContact}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-foreground whitespace-nowrap">
                          {money(payment.finalAmountArs)}
                        </td>
                        <td className="py-3 px-4 text-left whitespace-nowrap">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-muted/60 text-foreground border border-border/50">
                            {payment.paymentMethod}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 border-t border-border/80 font-medium">
                    <tr>
                      <td colSpan={4} className="py-3 px-4 font-semibold text-muted-foreground text-left">
                        Total cobrado
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-foreground text-sm whitespace-nowrap">
                        {money(paymentStats.totalCollected)}
                      </td>
                      <td className="py-3 px-4 text-left text-xs text-muted-foreground">
                        {payments.length} {payments.length === 1 ? "servicio" : "servicios"}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Vista mobile: lista de cards sin scroll horizontal */}
              <div className="block md:hidden divide-y divide-border/60">
                {payments.map((payment) => (
                  <div key={payment.id} className="p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                        <Clock className="w-3.5 h-3.5 text-gold shrink-0" />
                        {payment.paymentTime} hs
                        {payment.paymentDate !== todayStr && (
                          <span className="text-[11px] font-normal text-muted-foreground">
                            ({payment.paymentDate})
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-sm text-foreground">
                          {money(payment.finalAmountArs)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">
                        {payment.serviceName === "Otros" && payment.serviceOtherDetail
                          ? `${payment.serviceOtherDetail} (Otros)`
                          : payment.serviceName}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                        {payment.paymentMethod}
                      </span>
                    </div>

                    {payment.discountArs > 0 && (
                      <div className="text-[11px] text-destructive">
                        Descuento aplicado: −{money(payment.discountArs)} (Original: {money(payment.servicePriceArs)})
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-0.5 border-t border-border/40">
                      <div>
                        {payment.clientName ? (
                          <span className="text-foreground">{payment.clientName}</span>
                        ) : (
                          <span className="italic">—</span>
                        )}
                        {payment.clientContact && (
                          <span className="text-[10px] ml-1.5 text-muted-foreground">
                            ({payment.clientContact})
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] font-medium text-foreground">
                        Barbero: {payment.barberName}
                      </div>
                    </div>
                  </div>
                ))}
                {/* Total cobrado en mobile footer */}
                <div className="p-3.5 bg-muted/30 border-t border-border/80 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Total cobrado</span>
                  <span className="font-bold text-sm text-foreground">{money(paymentStats.totalCollected)}</span>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Total cobrado destacado debajo de Servicios registrados */}
        <section
          className="p-4 sm:p-5 rounded-xl border border-border bg-surface shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          aria-label="Resumen de Total cobrado"
        >
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Total cobrado
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Suma exacta de los registros en <code className="text-[11px]">service_payments</code> según los filtros activos.
            </p>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
            {money(paymentStats.totalCollected)}
          </div>
        </section>

        {/* 4. Estadísticas visuales de los cobros registrados */}
        <section
          className="rounded-xl border border-border bg-surface p-4 sm:p-5 shadow-xs space-y-5"
          aria-label="Estadísticas visuales de cobros"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 pb-3 border-b border-border/70">
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-gold" />
                Estadísticas de cobros
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Métricas calculadas exclusivamente sobre los cobros registrados con los filtros activos.
              </p>
            </div>
            <div className="text-xs text-muted-foreground">
              Filtro: <span className="font-semibold text-foreground">{presetLabels[filterPeriod]}</span>
            </div>
          </div>

          {/* Resumen - 3 KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* KPI 1: Total cobrado */}
            <div className="p-3.5 rounded-lg border border-border/80 bg-background/50 flex flex-col justify-between">
              <div className="flex items-center justify-between text-muted-foreground mb-1">
                <span className="text-xs font-medium">Total cobrado</span>
                <DollarSign className="w-4 h-4 text-gold" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-foreground">
                {money(paymentStats.totalCollected)}
              </div>
              <span className="text-[11px] text-muted-foreground mt-1">
                {paymentStats.servicesCount} {paymentStats.servicesCount === 1 ? "servicio" : "servicios"} registrados
              </span>
            </div>

            {/* KPI 2: Cantidad de servicios registrados */}
            <div className="p-3.5 rounded-lg border border-border/80 bg-background/50 flex flex-col justify-between">
              <div className="flex items-center justify-between text-muted-foreground mb-1">
                <span className="text-xs font-medium">Cantidad de servicios</span>
                <Scissors className="w-4 h-4 text-gold" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-foreground">
                {paymentStats.servicesCount}
              </div>
              <span className="text-[11px] text-muted-foreground mt-1">
                En el conjunto filtrado
              </span>
            </div>

            {/* KPI 3: Ticket promedio */}
            <div className="p-3.5 rounded-lg border border-border/80 bg-background/50 flex flex-col justify-between">
              <div className="flex items-center justify-between text-muted-foreground mb-1">
                <span className="text-xs font-medium">Ticket promedio</span>
                <Receipt className="w-4 h-4 text-gold" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-foreground">
                {money(paymentStats.averageTicket)}
              </div>
              <span className="text-[11px] text-muted-foreground mt-1">
                Total cobrado / servicios
              </span>
            </div>
          </div>

          {/* Gráficos / Desgloses visuales */}
          {paymentStats.servicesCount === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-lg">
              No hay servicios registrados para calcular gráficos con los filtros seleccionados.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Gráfico 1: Cobros por método de pago */}
              <div className="p-4 rounded-lg border border-border/70 bg-background/40 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-border/60">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                    <Wallet className="w-3.5 h-3.5 text-gold" />
                    Cobros por método de pago
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    {paymentStats.byMethod.length} métodos
                  </span>
                </div>
                <div className="space-y-3 pt-1">
                  {paymentStats.byMethod.map((item) => (
                    <div key={item.method} className="space-y-1">
                      <div className="flex justify-between items-baseline text-xs">
                        <span className="font-semibold text-foreground">{item.method}</span>
                        <div className="text-right">
                          <span className="font-bold text-foreground">{money(item.total)}</span>
                          <span className="text-[10px] text-muted-foreground ml-1.5">
                            ({Math.round(item.percentage)}%)
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted/50 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.max(item.total > 0 ? 4 : 0, item.percentage)}%`,
                            backgroundColor: item.method === "Efectivo" ? "var(--gold)" : "var(--primary)",
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>{item.count} {item.count === 1 ? "servicio" : "servicios"}</span>
                        <span>{item.percentage.toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Gráfico 2: Cobros por servicio */}
              <div className="p-4 rounded-lg border border-border/70 bg-background/40 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-border/60">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                    <Scissors className="w-3.5 h-3.5 text-gold" />
                    Cobros por servicio
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    {paymentStats.byService.length} servicios
                  </span>
                </div>
                <div className="space-y-3 pt-1">
                  {paymentStats.byService.map((item) => (
                    <div key={item.service} className="space-y-1">
                      <div className="flex justify-between items-baseline text-xs">
                        <span className="font-semibold text-foreground truncate max-w-[55%]">
                          {item.service}
                        </span>
                        <div className="text-right">
                          <span className="font-bold text-foreground">{money(item.total)}</span>
                          <span className="text-[10px] text-muted-foreground ml-1.5">
                            ({Math.round(item.percentage)}%)
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted/50 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.max(item.total > 0 ? 4 : 0, item.percentage)}%`,
                            backgroundColor: "var(--primary)",
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>{item.count} {item.count === 1 ? "servicio" : "servicios"}</span>
                        <span>{item.percentage.toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Gráfico 3: Cobros por barbero */}
              <div className="p-4 rounded-lg border border-border/70 bg-background/40 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-border/60">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-gold" />
                    Cobros por barbero
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    {paymentStats.byBarber.length} barberos
                  </span>
                </div>
                <div className="space-y-3 pt-1">
                  {paymentStats.byBarber.map((item) => (
                    <div key={item.barber} className="space-y-1">
                      <div className="flex justify-between items-baseline text-xs">
                        <span className="font-semibold text-foreground">{item.barber}</span>
                        <div className="text-right">
                          <span className="font-bold text-foreground">{money(item.total)}</span>
                          <span className="text-[10px] text-muted-foreground ml-1.5">
                            ({Math.round(item.percentage)}%)
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted/50 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.max(item.total > 0 ? 4 : 0, item.percentage)}%`,
                            backgroundColor: "var(--gold)",
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>{item.count} {item.count === 1 ? "servicio" : "servicios"}</span>
                        <span>{item.percentage.toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
