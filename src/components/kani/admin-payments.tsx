import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart2,
  Check,
  CheckCircle2,
  Clock,
  DollarSign,
  Link2,
  Pencil,
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
  deleteServicePayment,
  fetchServicePayments,
  recordServicePayment,
  STANDARD_SERVICE_PRICES,
  updateServicePayment,
  validatePaymentInput,
  type PaymentMethod,
  type RecordServicePaymentInput,
  type ServicePaymentOrigin,
  type ServicePayment,
  type ServicePaymentFilters,
  type ServicePaymentType,
  type UpdateServicePaymentInput,
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
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Estados para Edición y Eliminación
  const [editingPayment, setEditingPayment] = useState<ServicePayment | null>(null);
  const [paymentToDelete, setPaymentToDelete] = useState<ServicePayment | null>(null);

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
  const [formOrigin, setFormOrigin] = useState<ServicePaymentOrigin>("walk_in");

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

  // Turnos disponibles para vinculación (excluyendo los que ya tienen cobro registrado, salvo el turno en edición)
  const availableAppointments = useMemo(() => {
    return appointments
      .filter((apt) => {
        if (alreadyPaidAppointmentIds.has(apt.id)) {
          if (!editingPayment || editingPayment.appointmentId !== apt.id) {
            return false;
          }
        }
        if (!isAdmin && staff.profile.barber_id) {
          if (apt.barberId && apt.barberId !== staff.profile.barber_id) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        if (a.date === formDate && b.date !== formDate) return -1;
        if (a.date !== formDate && b.date === formDate) return 1;
        return (b.date + (b.time || "")).localeCompare(a.date + (a.time || ""));
      });
  }, [appointments, alreadyPaidAppointmentIds, editingPayment, isAdmin, staff.profile.barber_id, formDate]);

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

  // Desvincular turno
  function handleUnlinkAppointment() {
    setLinkedAppointment(null);
    setFormOnlineDepositPaid(false);
  }

  // Cambiar origen del servicio (Con turno / Sin turno)
  function handleOriginChange(origin: ServicePaymentOrigin) {
    setFormOrigin(origin);
    if (origin === "walk_in") {
      setLinkedAppointment(null);
      setFormOnlineDepositPaid(false);
    }
  }

  // Seleccionar turno directamente de la lista de turnos disponibles
  function handleSelectAppointment(apt: RealAppointment) {
    setLinkedAppointment(apt);
    setFormDate(apt.date);
    if (apt.time) setFormTime(apt.time);
    if (apt.barberId) setFormBarberId(apt.barberId);
    if (apt.name) setFormClientName(apt.name);
    if (apt.phone || apt.email) setFormClientContact(apt.phone || apt.email || "");

    const srvLower = (apt.service || "").toLowerCase();
    if (srvLower.includes("barba") && srvLower.includes("corte")) {
      setFormServiceName("Corte y barba");
      setFormPriceArs(STANDARD_SERVICE_PRICES["Corte y barba"]);
    } else if (srvLower.includes("barba")) {
      setFormServiceName("Barba");
      setFormPriceArs(STANDARD_SERVICE_PRICES["Barba"]);
    } else {
      setFormServiceName("Corte");
      setFormPriceArs(STANDARD_SERVICE_PRICES["Corte"]);
    }

    setFormOnlineDepositPaid(Boolean(apt.depositPaid));
  }

  // Cálculos económicos en vivo
  const numericDiscount = Math.max(0, Number(formDiscountArs) || 0);
  const totalCalculated = Math.max(0, formPriceArs - numericDiscount);
  const depositDeduction =
    linkedAppointment && linkedAppointment.depositPaid && formOnlineDepositPaid
      ? linkedAppointment.depositAmountArs || 5000
      : 0;
  const balanceToCollectAtShop = Math.max(0, totalCalculated - depositDeduction);

  // Permisos de gestión
  const canDelete = isAdmin;
  const canEdit = (p: ServicePayment) => isAdmin || p.barberId === staff.profile.barber_id;

  // Iniciar edición de un cobro
  function handleStartEdit(p: ServicePayment) {
    if (!canEdit(p)) {
      setErrorMessage("No tenés permisos para editar este cobro.");
      return;
    }
    setEditingPayment(p);
    setFormBarberId(p.barberId);
    setFormDate(p.paymentDate);
    setFormTime(p.paymentTime);
    setFormServiceName(p.serviceName);
    setFormOtherDetail(p.serviceOtherDetail || "");
    setFormPriceArs(p.servicePriceArs);
    setFormDiscountArs(p.discountArs || 0);
    setFormClientName(p.clientName || "");
    setFormClientContact(p.clientContact || "");
    setFormPaymentMethod(p.paymentMethod);
    setFormOnlineDepositPaid(p.onlineDepositPaid);
    setFormOrigin(p.serviceOrigin || (p.appointmentId ? "appointment" : "walk_in"));
    if (p.appointmentId) {
      const match = appointments.find((a) => a.id === p.appointmentId);
      setLinkedAppointment(match || null);
    } else {
      setLinkedAppointment(null);
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Cancelar edición
  function handleCancelEdit() {
    setEditingPayment(null);
    handleResetForm();
  }

  // Confirmar eliminación (exclusivo Admin)
  async function handleConfirmDelete() {
    if (!paymentToDelete) return;
    if (!canDelete) {
      setErrorMessage("No tenés permisos para eliminar registros de cobro.");
      setPaymentToDelete(null);
      return;
    }
    setIsDeleting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await deleteServicePayment(paymentToDelete.id, staff);
      setPayments((prev) => prev.filter((p) => p.id !== paymentToDelete.id));
      setSuccessMessage("Cobro eliminado exitosamente.");
      if (editingPayment?.id === paymentToDelete.id) {
        setEditingPayment(null);
        handleResetForm();
      }
      setPaymentToDelete(null);
      await loadData();
    } catch (err: any) {
      console.error("[AdminPayments] Error al eliminar cobro:", err);
      setErrorMessage(err.message || "No se pudo eliminar el registro de cobro.");
    } finally {
      setIsDeleting(false);
    }
  }

  // Reiniciar formulario
  function handleResetForm() {
    setEditingPayment(null);
    setFormOrigin("walk_in");
    setFormBarberId(defaultBarberId);
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
    setErrorMessage(null);
  }

  // Enviar formulario (Creación o Edición)
  async function handleSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    // Modo Edición
    if (editingPayment) {
      if (!canEdit(editingPayment)) {
        setErrorMessage("No tenés permisos para editar este cobro.");
        return;
      }
      const updateInput: UpdateServicePaymentInput = {
        barberId: isAdmin ? formBarberId : undefined,
        serviceName: formServiceName,
        serviceOtherDetail: formServiceName === "Otros" ? formOtherDetail.trim() : undefined,
        servicePriceArs: formPriceArs,
        discountArs: numericDiscount,
        paymentDate: formDate,
        paymentTime: formTime,
        paymentMethod: formPaymentMethod,
        clientName: formClientName.trim() || undefined,
        clientContact: formClientContact.trim() || undefined,
        appointmentId: formOrigin === "appointment" ? (linkedAppointment?.id || null) : null,
        serviceOrigin: formOrigin,
      };

      setIsSubmitting(true);
      try {
        const updated = await updateServicePayment(editingPayment.id, updateInput, staff, editingPayment);
        setSuccessMessage("Cobro actualizado exitosamente.");
        setPayments((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        setEditingPayment(null);
        handleResetForm();
        await loadData();
      } catch (err: any) {
        console.error("[AdminPayments] Error al actualizar cobro:", err);
        setErrorMessage(err.message || "No se pudo actualizar el registro de cobro.");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Modo Creación
    const input: RecordServicePaymentInput = {
      barberId: formBarberId,
      serviceName: formServiceName,
      serviceOtherDetail: formServiceName === "Otros" ? formOtherDetail.trim() : undefined,
      servicePriceArs: formPriceArs,
      discountArs: numericDiscount,
      paymentDate: formDate,
      paymentTime: formTime,
      paymentMethod: formPaymentMethod,
      onlineDepositPaid: formOrigin === "appointment" ? formOnlineDepositPaid : false,
      clientName: formClientName.trim() || undefined,
      clientContact: formClientContact.trim() || undefined,
      appointmentId: formOrigin === "appointment" ? (linkedAppointment?.id || undefined) : undefined,
      serviceOrigin: formOrigin,
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

  // Cálculos de validación de campos para estado visual sutil (borde verde)
  const isDateValid = Boolean(formDate && /^\d{4}-\d{2}-\d{2}$/.test(formDate));
  const isTimeValid = Boolean(formTime && /^\d{2}:\d{2}/.test(formTime));
  const isBarberValid = Boolean(formBarberId);
  const isServiceValid = Boolean(formServiceName && (formServiceName !== "Otros" || formOtherDetail.trim().length > 0));
  const isPriceValid = Number(formPriceArs) > 0;
  const isMethodValid = Boolean(formPaymentMethod);

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

        {/* 1. Formulario de registro rápido o edición */}
        <section
          className="p-3 sm:p-4 rounded-xl border border-border bg-surface shadow-xs mb-4"
          aria-label={editingPayment ? "Editar servicio registrado" : "Registrar servicio"}
        >
          <div className="flex items-center justify-between gap-3 mb-3 pb-2.5 border-b border-border/60">
            <div className="flex items-center gap-1.5">
              <Scissors className="w-4 h-4 text-primary shrink-0" />
              <h2 className="text-sm font-semibold text-foreground">
                {editingPayment ? "Editar servicio registrado" : "Registrar servicio"}
              </h2>
            </div>

            {/* Selector de Origen: Con turno / Sin turno */}
            <div className="flex items-center gap-1 p-0.5 bg-muted/40 rounded-lg border border-border shrink-0" role="radiogroup" aria-label="Origen del servicio">
              <button
                type="button"
                onClick={() => handleOriginChange("appointment")}
                className={`px-2.5 py-1 text-xs rounded-md transition-all ${
                  formOrigin === "appointment"
                    ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-pressed={formOrigin === "appointment"}
              >
                Con turno
              </button>
              <button
                type="button"
                onClick={() => handleOriginChange("walk_in")}
                className={`px-2.5 py-1 text-xs rounded-md transition-all ${
                  formOrigin === "walk_in"
                    ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-pressed={formOrigin === "walk_in"}
              >
                Sin turno
              </button>
            </div>
          </div>

          {editingPayment && (
            <div className="mb-3 p-2.5 rounded-lg border border-primary/40 bg-primary/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-foreground font-semibold">
                <Pencil className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>
                  Editando servicio registrado ({editingPayment.serviceName} · {money(editingPayment.finalAmountArs)})
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCancelEdit}
                className="h-7 px-2 text-xs self-start sm:self-auto"
              >
                Cancelar edición
              </Button>
            </div>
          )}

          {/* Selector de turno o resumen de turno vinculado en modo Con turno */}
          {formOrigin === "appointment" && (
            <div className="mb-3">
              {linkedAppointment ? (
                <div className="px-3 py-2 rounded-lg border border-primary/30 bg-primary/5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-primary" />
                      {linkedAppointment.name}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                      Turno #{linkedAppointment.requestNumber}
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      {formDate} · {formTime} hs · {formServiceName}
                    </span>
                    {depositDeduction > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        Seña {money(depositDeduction)}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleUnlinkAppointment}
                    className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 font-medium transition-colors ml-auto sm:ml-0"
                    title="Cambiar turno"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Cambiar turno</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="form-select-appointment" className="text-xs font-medium text-foreground">
                      Elegir turno agendado
                    </label>
                    <span className="text-[11px] text-muted-foreground">
                      {availableAppointments.length} turnos disponibles
                    </span>
                  </div>
                  <select
                    id="form-select-appointment"
                    value=""
                    onChange={(e) => {
                      const selectedId = e.target.value;
                      const match = appointments.find((a) => a.id === selectedId);
                      if (match) handleSelectAppointment(match);
                    }}
                    className="select-control w-full h-9 px-2.5 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                  >
                    <option value="">
                      -- Seleccionar turno de la agenda --
                    </option>
                    {availableAppointments.map((apt) => (
                      <option key={apt.id} value={apt.id}>
                        {apt.date === formDate ? "● [Hoy] " : ""}{apt.date} {apt.time} hs · #{apt.requestNumber} {apt.name} ({apt.service}) · {apt.barber} {apt.depositPaid ? "· Seña paga" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmitForm} className="space-y-3">
            <div className={`admin-payment-form-grid ${formServiceName === "Otros" ? "has-other" : ""}`}>
              {/* Fecha */}
              <div className="payment-field-fecha min-w-0">
                <label htmlFor="form-date" className="block text-xs font-medium text-muted-foreground mb-1">
                  Fecha *
                </label>
                <input
                  id="form-date"
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className={`select-control w-full h-9 px-2 text-xs bg-background rounded-lg transition-colors focus:outline-none min-w-0 max-w-full ${
                    isDateValid
                      ? "border border-emerald-500/60 focus:border-emerald-500 text-foreground"
                      : "border border-border focus:ring-1 focus:ring-foreground/20 text-foreground"
                  }`}
                  required
                />
              </div>

              {/* Horario */}
              <div className="payment-field-horario min-w-0">
                <label htmlFor="form-time" className="block text-xs font-medium text-muted-foreground mb-1">
                  Horario *
                </label>
                <input
                  id="form-time"
                  type="time"
                  value={formTime}
                  onChange={(e) => setFormTime(e.target.value)}
                  className={`select-control w-full h-9 px-2 text-xs bg-background rounded-lg transition-colors focus:outline-none min-w-0 max-w-full ${
                    isTimeValid
                      ? "border border-emerald-500/60 focus:border-emerald-500 text-foreground"
                      : "border border-border focus:ring-1 focus:ring-foreground/20 text-foreground"
                  }`}
                  required
                />
              </div>

              {/* Barbero */}
              <div className="payment-field-barbero min-w-0">
                {isAdmin ? (
                  <>
                    <label htmlFor="form-barber" className="block text-xs font-medium text-muted-foreground mb-1">
                      Barbero *
                    </label>
                    <select
                      id="form-barber"
                      value={formBarberId}
                      onChange={(e) => setFormBarberId(e.target.value)}
                      className={`select-control w-full h-9 px-2 text-xs bg-background rounded-lg transition-colors focus:outline-none min-w-0 max-w-full ${
                        isBarberValid
                          ? "border border-emerald-500/60 focus:border-emerald-500 text-foreground"
                          : "border border-border focus:ring-1 focus:ring-foreground/20 text-foreground"
                      }`}
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
                    <output className="select-control w-full h-9 px-2 text-xs bg-muted/40 border border-emerald-500/60 rounded-lg text-foreground flex items-center min-w-0 max-w-full">
                      {staff.profile.display_name}
                    </output>
                  </>
                )}
              </div>

              {/* Servicio */}
              <div className="payment-field-servicio min-w-0">
                <label htmlFor="form-service" className="block text-xs font-medium text-muted-foreground mb-1">
                  Servicio *
                </label>
                <select
                  id="form-service"
                  value={formServiceName}
                  onChange={(e) => handleServiceChange(e.target.value as ServicePaymentType)}
                  className={`select-control w-full h-9 px-2 text-xs bg-background rounded-lg transition-colors focus:outline-none font-medium min-w-0 max-w-full ${
                    isServiceValid
                      ? "border border-emerald-500/60 focus:border-emerald-500 text-foreground"
                      : "border border-border focus:ring-1 focus:ring-foreground/20 text-foreground"
                  }`}
                >
                  <option value="Corte">Corte</option>
                  <option value="Corte y barba">Corte y barba</option>
                  <option value="Barba">Barba</option>
                  <option value="Otros">Otros (Personalizado)</option>
                </select>
              </div>

              {/* Detalle del servicio (solo si Otros) */}
              {formServiceName === "Otros" && (
                <div className="payment-field-detalle min-w-0">
                  <label htmlFor="form-other-detail" className="block text-xs font-medium text-muted-foreground mb-1">
                    Detalle del servicio *
                  </label>
                  <input
                    id="form-other-detail"
                    type="text"
                    placeholder="Ej: Lavado, Color, Peinado..."
                    value={formOtherDetail}
                    onChange={(e) => setFormOtherDetail(e.target.value)}
                    className={`select-control w-full h-9 px-2 text-xs bg-background rounded-lg transition-colors focus:outline-none min-w-0 max-w-full ${
                      formOtherDetail.trim().length > 0
                        ? "border border-emerald-500/60 focus:border-emerald-500 text-foreground"
                        : "border border-border focus:ring-1 focus:ring-foreground/20 text-foreground"
                    }`}
                    required
                  />
                </div>
              )}

              {/* Importe */}
              <div className="payment-field-importe min-w-0">
                <label htmlFor="form-price" className="block text-xs font-medium text-muted-foreground mb-1">
                  Importe *
                </label>
                {formServiceName === "Otros" ? (
                  <input
                    id="form-price"
                    type="number"
                    min="1"
                    step="100"
                    placeholder="0"
                    value={formPriceArs || ""}
                    onChange={(e) => setFormPriceArs(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className={`select-control w-full h-9 px-2 text-xs bg-background rounded-lg transition-colors focus:outline-none text-right font-medium min-w-0 max-w-full ${
                      isPriceValid
                        ? "border border-emerald-500/60 focus:border-emerald-500 text-foreground"
                        : "border border-border focus:ring-1 focus:ring-foreground/20 text-foreground"
                    }`}
                    required
                  />
                ) : (
                  <output
                    id="form-price"
                    className={`select-control w-full h-9 px-2 text-xs bg-muted/30 rounded-lg text-foreground font-semibold flex items-center justify-end text-right min-w-0 max-w-full ${
                      isPriceValid
                        ? "border border-emerald-500/60"
                        : "border border-border"
                    }`}
                  >
                    {money(formPriceArs)}
                  </output>
                )}
              </div>

              {/* Descuento (opcional) */}
              <div className="payment-field-descuento min-w-0">
                <label htmlFor="form-discount" className="block text-xs font-medium text-muted-foreground mb-1">
                  Descuento
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
                  className="select-control w-full h-9 px-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 text-right font-medium min-w-0 max-w-full"
                />
              </div>

              {/* Método de pago */}
              <div className="payment-field-metodo min-w-0">
                <label htmlFor="form-payment-method" className="block text-xs font-medium text-muted-foreground mb-1">
                  Método de pago *
                </label>
                <select
                  id="form-payment-method"
                  value={formPaymentMethod}
                  onChange={(e) => setFormPaymentMethod(e.target.value as PaymentMethod)}
                  className={`select-control w-full h-9 px-2 text-xs bg-background rounded-lg transition-colors focus:outline-none font-medium min-w-0 max-w-full ${
                    isMethodValid
                      ? "border border-emerald-500/60 focus:border-emerald-500 text-foreground"
                      : "border border-border focus:ring-1 focus:ring-foreground/20 text-foreground"
                  }`}
                >
                  <option value="Efectivo">Efectivo</option>
                  <option value="Transferencia">Transferencia</option>
                </select>
              </div>

              {/* Seña abonada */}
              <div className="payment-field-sena min-w-0">
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
                  className={`select-control w-full h-9 px-2 text-xs bg-background rounded-lg transition-colors focus:outline-none min-w-0 max-w-full ${
                    formOnlineDepositPaid
                      ? "border border-emerald-500/60 focus:border-emerald-500 text-foreground font-medium"
                      : "border border-border focus:ring-1 focus:ring-foreground/20 text-foreground"
                  }`}
                >
                  <option value="NO">No</option>
                  <option value="SI">Sí (Verificado)</option>
                </select>
              </div>

              {/* Cliente (opcional) */}
              <div className="payment-field-cliente min-w-0">
                <label htmlFor="form-client-name" className="block text-xs font-medium text-muted-foreground mb-1">
                  Cliente (opcional)
                </label>
                <input
                  id="form-client-name"
                  type="text"
                  placeholder="Nombre y apellido"
                  value={formClientName}
                  onChange={(e) => setFormClientName(e.target.value)}
                  className={`select-control w-full h-9 px-2 text-xs bg-background rounded-lg transition-colors focus:outline-none text-foreground min-w-0 max-w-full ${
                    formClientName.trim().length > 0
                      ? "border border-emerald-500/60 focus:border-emerald-500"
                      : "border border-border focus:ring-1 focus:ring-foreground/20"
                  }`}
                />
              </div>

              {/* Contacto (opcional) */}
              <div className="payment-field-contacto min-w-0">
                <label htmlFor="form-client-contact" className="block text-xs font-medium text-muted-foreground mb-1">
                  Contacto (opcional)
                </label>
                <input
                  id="form-client-contact"
                  type="text"
                  placeholder="Celular o email"
                  value={formClientContact}
                  onChange={(e) => setFormClientContact(e.target.value)}
                  className={`select-control w-full h-9 px-2 text-xs bg-background rounded-lg transition-colors focus:outline-none text-foreground min-w-0 max-w-full ${
                    formClientContact.trim().length > 0
                      ? "border border-emerald-500/60 focus:border-emerald-500"
                      : "border border-border focus:ring-1 focus:ring-foreground/20"
                  }`}
                />
              </div>
            </div>

            {/* Resumen financiero compacto (Fila 6) */}
            <div className="grid grid-cols-3 gap-2 py-1.5 px-3 rounded-lg border border-border/70 bg-background/50 text-xs items-center">
              <div className="min-w-0">
                <span className="block text-[11px] font-medium text-muted-foreground">Importe</span>
                <span className="font-semibold text-foreground text-xs sm:text-sm truncate block">
                  {money(formPriceArs)}
                </span>
              </div>
              <div className="min-w-0 text-center">
                <span className="block text-[11px] font-medium text-muted-foreground">Método</span>
                <span className="font-semibold text-foreground text-xs sm:text-sm truncate block">
                  {formPaymentMethod}
                </span>
              </div>
              <div className="min-w-0 text-right">
                <span className="block text-[11px] font-medium text-muted-foreground">Total</span>
                <span className="font-bold text-foreground text-xs sm:text-sm truncate block">
                  {money(balanceToCollectAtShop)}
                </span>
              </div>
            </div>

            {/* Botones de acción */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={editingPayment ? handleCancelEdit : handleResetForm}
                disabled={isSubmitting}
                className="h-8 px-3 text-xs"
              >
                {editingPayment ? "Cancelar edición" : "Limpiar"}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting}
                className="h-8 px-4 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {isSubmitting
                  ? "Guardando…"
                  : editingPayment
                  ? "Guardar cambios"
                  : "Guardar cobro"}
              </Button>
            </div>
          </form>
        </section>

        {/* 2. Filtros de historial persistido */}
        <section
          className="p-3.5 sm:p-4 rounded-xl border border-border bg-surface shadow-xs mb-4 sm:mb-5"
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
            <div className="min-w-0">
              <label htmlFor="filter-date" className="block text-xs font-medium text-muted-foreground mb-1">
                Fecha específica
              </label>
              <input
                id="filter-date"
                type="date"
                value={filterDate}
                onChange={(e) => handleSpecificDateChange(e.target.value)}
                className={`select-control w-full h-9 px-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 min-w-0 max-w-full ${
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
          className="rounded-xl border border-border bg-surface shadow-xs overflow-hidden mb-4 sm:mb-5"
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
              {/* Vista desktop: tabla con 6 columnas independientes (Importe es siempre la última) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs text-foreground">
                  <thead className="bg-muted/40 border-b border-border font-medium text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-2.5 px-4 font-medium text-left">Hora</th>
                      <th scope="col" className="py-2.5 px-4 font-medium text-left">Servicio</th>
                      <th scope="col" className="py-2.5 px-4 font-medium text-left">Barbero</th>
                      <th scope="col" className="py-2.5 px-4 font-medium text-left">Cliente</th>
                      <th scope="col" className="py-2.5 px-4 font-medium text-left">Método de pago</th>
                      <th scope="col" className="py-2.5 px-4 font-medium text-right">Importe</th>
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
                          <div className="flex items-center gap-1.5 font-semibold text-foreground">
                            <span>
                              {payment.serviceName === "Otros" && payment.serviceOtherDetail
                                ? `${payment.serviceOtherDetail} (Otros)`
                                : payment.serviceName}
                            </span>
                            {payment.serviceOrigin === 'appointment' || payment.appointmentId ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                                Con turno
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/60 text-muted-foreground border border-border/50">
                                Sin turno
                              </span>
                            )}
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
                        <td className="py-3 px-4 text-left whitespace-nowrap">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-muted/60 text-foreground border border-border/50">
                            {payment.paymentMethod}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="font-bold text-foreground text-sm">
                            {money(payment.finalAmountArs)}
                          </div>
                          <div className="flex items-center justify-end gap-1.5 mt-1">
                            {canEdit(payment) && (
                              <button
                                type="button"
                                onClick={() => handleStartEdit(payment)}
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                                title="Editar cobro"
                              >
                                <Pencil className="w-3 h-3" />
                                <span>Editar</span>
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => setPaymentToDelete(payment)}
                                className="inline-flex items-center gap-1 text-[11px] text-destructive/80 hover:text-destructive transition-colors px-1.5 py-0.5 rounded hover:bg-destructive/10"
                                title="Eliminar cobro"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Eliminar</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 border-t border-border/80 font-medium">
                    <tr>
                      <td colSpan={4} className="py-3 px-4 font-semibold text-muted-foreground text-left">
                        Total cobrado
                      </td>
                      <td className="py-3 px-4 text-left text-xs text-muted-foreground whitespace-nowrap">
                        {payments.length} {payments.length === 1 ? "servicio" : "servicios"}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-foreground text-sm whitespace-nowrap">
                        {money(paymentStats.totalCollected)}
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
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-foreground">
                          {payment.serviceName === "Otros" && payment.serviceOtherDetail
                            ? `${payment.serviceOtherDetail} (Otros)`
                            : payment.serviceName}
                        </span>
                        {payment.serviceOrigin === 'appointment' || payment.appointmentId ? (
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                            Con turno
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-medium bg-muted/60 text-muted-foreground border border-border/50">
                            Sin turno
                          </span>
                        )}
                      </div>
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

                    {/* Acciones en mobile */}
                    {(canEdit(payment) || canDelete) && (
                      <div className="flex items-center justify-end gap-2 pt-1.5 border-t border-border/40">
                        {canEdit(payment) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleStartEdit(payment)}
                            className="h-7 text-xs px-2.5 gap-1"
                          >
                            <Pencil className="w-3 h-3" />
                            Editar
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPaymentToDelete(payment)}
                            className="h-7 text-xs px-2.5 gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                          >
                            <Trash2 className="w-3 h-3" />
                            Eliminar
                          </Button>
                        )}
                      </div>
                    )}
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

        {/* 4. Estadísticas visuales de los cobros registrados */}
        <section
          className="rounded-xl border border-border bg-surface p-4 sm:p-5 shadow-xs space-y-4"
          aria-label="Estadísticas visuales de cobros"
        >
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

        {/* Modal de confirmación explícita para eliminar cobro (Exclusivo Administrador) */}
        {paymentToDelete && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          >
            <div className="bg-surface border border-border rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-full bg-destructive/15 text-destructive shrink-0 mt-0.5">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 id="delete-dialog-title" className="text-sm font-bold text-foreground">
                    ¿Eliminar este cobro?
                  </h3>
                  <p className="text-xs text-muted-foreground leading-normal">
                    Esta acción no se puede deshacer. Se eliminará el registro de{" "}
                    <strong className="text-foreground">{paymentToDelete.serviceName}</strong> (
                    {money(paymentToDelete.finalAmountArs)}) correspondiente a{" "}
                    <strong className="text-foreground">{paymentToDelete.barberName}</strong>.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/60">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPaymentToDelete(null)}
                  disabled={isDeleting}
                  className="h-9 px-4 text-xs"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="h-9 px-4 text-xs font-semibold bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                >
                  {isDeleting ? "Eliminando…" : "Eliminar definitivamente"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
