import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Edit2,
  Gift,
  HelpCircle,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import {
  BENEFIT_TYPE_DEFINITIONS,
  BENEFIT_USAGE_MODE_DEFINITIONS,
  BENEFIT_VALIDITY_TYPE_DEFINITIONS,
  calculateValidityDates,
  computeBenefitCodeStatus,
  formatBuenosAiresDate,
  formatBuenosAiresDateTime,
  getBuenosAiresTodayDateString,
  type BenefitCodeItem,
  type BenefitCodeStatus,
  type BenefitCodeType,
  type BenefitDurationUnit,
  type BenefitUsageMode,
  type BenefitValidityType,
} from '@/lib/kani-benefit-codes';
import {
  adminCreateBenefitCodeFn,
  adminDeleteBenefitCodeFn,
  adminDisableBenefitCodeFn,
  adminListBenefitCodesFn,
  adminToggleBenefitCodeStatusFn,
  adminUpdateBenefitCodeValidityFn,
} from '@/lib/kani-benefit-codes.functions';
import { money, formatServiceName } from '@/lib/kani-model';

export type BenefitCodeSortOption = 'RECENT' | 'OLDEST' | 'CODE_ASC' | 'CODE_DESC' | 'MOST_USED';

export function BenefitCodesAdminSection() {
  const [items, setItems] = useState<BenefitCodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | BenefitCodeStatus>('ALL');
  const [sortBy, setSortBy] = useState<BenefitCodeSortOption>('RECENT');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedCodeIds, setExpandedCodeIds] = useState<Set<string>>(new Set());

  // Create Modal State
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<BenefitCodeType>('PERCENT_10');
  const [selectedUsageMode, setSelectedUsageMode] = useState<BenefitUsageMode>('SINGLE_USE');
  const [selectedValidityType, setSelectedValidityType] = useState<BenefitValidityType>('NO_EXPIRATION');
  const [createStartDate, setCreateStartDate] = useState(getBuenosAiresTodayDateString());
  const [createEndDate, setCreateEndDate] = useState('');
  const [createDurationValue, setCreateDurationValue] = useState<number>(7);
  const [createDurationUnit, setCreateDurationUnit] = useState<BenefitDurationUnit>('DAYS');
  const [internalNote, setInternalNote] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdItem, setCreatedItem] = useState<BenefitCodeItem | null>(null);

  // Edit Validity Modal State (Reusable codes)
  const [codeToEditValidity, setCodeToEditValidity] = useState<BenefitCodeItem | null>(null);
  const [editValidityType, setEditValidityType] = useState<BenefitValidityType>('NO_EXPIRATION');
  const [editStartDate, setEditStartDate] = useState(getBuenosAiresTodayDateString());
  const [editEndDate, setEditEndDate] = useState('');
  const [editDurationValue, setEditDurationValue] = useState<number>(7);
  const [editDurationUnit, setEditDurationUnit] = useState<BenefitDurationUnit>('DAYS');
  const [editingValidity, setEditingValidity] = useState(false);
  const [editValidityError, setEditValidityError] = useState('');

  // Status Toggle Modal State (Activate / Disable)
  const [codeToToggle, setCodeToToggle] = useState<{ item: BenefitCodeItem; targetActive: boolean } | null>(null);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [toggleStatusError, setToggleStatusError] = useState('');

  // Delete Modal State (Soft delete)
  const [codeToDelete, setCodeToDelete] = useState<BenefitCodeItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Copy indicator
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const loadCodes = async () => {
    setLoading(true);
    setError(null);
    try {
      let token: string | undefined;
      try {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token;
      } catch {
        // Fallback seguro si se ejecuta en SSR o entorno sin storage
      }
      const res = await adminListBenefitCodesFn({
        data: { token, includeDeleted: true },
      });
      // Asegurar estados calculados homogéneos
      const processed = (res || []).map((it) => ({
        ...it,
        status: computeBenefitCodeStatus(it),
      }));
      setItems(processed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al consultar códigos de beneficio.';
      setError(msg);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCodes();
  }, []);

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2500);
    } catch {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2500);
    }
  };

  const toggleAccordion = (id: string) => {
    setExpandedCodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Preview dinámico para la creación
  const createValidityPreview = useMemo(() => {
    return calculateValidityDates({
      validityType: selectedValidityType,
      startDate: createStartDate,
      endDate: createEndDate,
      durationValue: createDurationValue,
      durationUnit: createDurationUnit,
    });
  }, [selectedValidityType, createStartDate, createEndDate, createDurationValue, createDurationUnit]);

  // Preview dinámico para la edición de vigencia
  const editValidityPreview = useMemo(() => {
    return calculateValidityDates({
      validityType: editValidityType,
      startDate: editStartDate,
      endDate: editEndDate,
      durationValue: editDurationValue,
      durationUnit: editDurationUnit,
    });
  }, [editValidityType, editStartDate, editEndDate, editDurationValue, editDurationUnit]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError('');

    if (!createValidityPreview.isValid) {
      setCreateError(createValidityPreview.error || 'La configuración de vigencia es inválida.');
      setCreating(false);
      return;
    }

    try {
      let token: string | undefined;
      try {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token;
      } catch {
        // Fallback
      }
      const newItem = await adminCreateBenefitCodeFn({
        data: {
          type: selectedType,
          usageMode: selectedUsageMode,
          validityType: selectedValidityType,
          startDate: createStartDate,
          endDate: selectedValidityType === 'DATE_RANGE' ? createEndDate : undefined,
          durationValue: selectedValidityType === 'CUSTOM_DURATION' ? createDurationValue : undefined,
          durationUnit: selectedValidityType === 'CUSTOM_DURATION' ? createDurationUnit : undefined,
          internalNote: internalNote.trim() || undefined,
          code: customCode.trim() || undefined,
          token,
        },
      });
      setCreatedItem(newItem);
      setInternalNote('');
      setCustomCode('');
      setCreateOpen(false);
      await loadCodes();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'No se pudo generar el código.');
    } finally {
      setCreating(false);
    }
  };

  const handleEditValidityOpen = (item: BenefitCodeItem) => {
    setCodeToEditValidity(item);
    setEditValidityType(item.validityType || 'NO_EXPIRATION');
    const today = getBuenosAiresTodayDateString();
    setEditStartDate(item.validFrom ? getBuenosAiresTodayDateString(new Date(item.validFrom)) : today);
    setEditEndDate(item.validUntil ? getBuenosAiresTodayDateString(new Date(item.validUntil)) : '');
    setEditDurationValue(item.validityDurationValue || 7);
    setEditDurationUnit(item.validityDurationUnit || 'DAYS');
    setEditValidityError('');
  };

  const handleEditValiditySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeToEditValidity) return;
    setEditingValidity(true);
    setEditValidityError('');

    if (!editValidityPreview.isValid) {
      setEditValidityError(editValidityPreview.error || 'La configuración de vigencia es inválida.');
      setEditingValidity(false);
      return;
    }

    try {
      let token: string | undefined;
      try {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token;
      } catch {
        // Fallback
      }
      await adminUpdateBenefitCodeValidityFn({
        data: {
          codeId: codeToEditValidity.id,
          validityType: editValidityType,
          startDate: editStartDate,
          endDate: editValidityType === 'DATE_RANGE' ? editEndDate : undefined,
          durationValue: editValidityType === 'CUSTOM_DURATION' ? editDurationValue : undefined,
          durationUnit: editValidityType === 'CUSTOM_DURATION' ? editDurationUnit : undefined,
          token,
        },
      });
      setCodeToEditValidity(null);
      await loadCodes();
    } catch (err) {
      setEditValidityError(err instanceof Error ? err.message : 'Error al actualizar vigencia.');
    } finally {
      setEditingValidity(false);
    }
  };

  const handleToggleConfirm = async () => {
    if (!codeToToggle) return;
    setTogglingStatus(true);
    setToggleStatusError('');

    try {
      let token: string | undefined;
      try {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token;
      } catch {
        // Fallback
      }
      if (!codeToToggle.targetActive) {
        await adminDisableBenefitCodeFn({
          data: {
            codeId: codeToToggle.item.id,
            token,
          },
        });
      } else {
        await adminToggleBenefitCodeStatusFn({
          data: {
            codeId: codeToToggle.item.id,
            active: true,
            token,
          },
        });
      }
      setCodeToToggle(null);
      await loadCodes();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al modificar el estado del código.';
      setToggleStatusError(msg);
    } finally {
      setTogglingStatus(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!codeToDelete) return;
    setDeleting(true);
    setDeleteError('');
    try {
      let token: string | undefined;
      try {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token;
      } catch {
        // Fallback
      }
      await adminDeleteBenefitCodeFn({
        data: {
          codeId: codeToDelete.id,
          token,
        },
      });
      setCodeToDelete(null);
      await loadCodes();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Error al eliminar el código.');
    } finally {
      setDeleting(false);
    }
  };

  const statusCounts = useMemo(() => {
    return {
      ALL: items.length,
      ACTIVE: items.filter((i) => i.status === 'ACTIVE').length,
      SCHEDULED: items.filter((i) => i.status === 'SCHEDULED').length,
      DISABLED: items.filter((i) => i.status === 'DISABLED').length,
      EXPIRED: items.filter((i) => i.status === 'EXPIRED').length,
      CONSUMED: items.filter((i) => i.status === 'CONSUMED').length,
      DELETED: items.filter((i) => i.status === 'DELETED').length,
    };
  }, [items]);

  const filteredAndSortedItems = useMemo(() => {
    // 1. Filtrar por estado y término de búsqueda
    const filtered = items.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      const noteMatch = item.internalNote ? item.internalNote.toLowerCase().includes(term) : false;
      const codeMatch = item.code.toLowerCase().includes(term);
      const clientDirectMatch =
        (item.clientName && item.clientName.toLowerCase().includes(term)) ||
        (item.clientEmail && item.clientEmail.toLowerCase().includes(term)) ||
        (item.clientPhone && item.clientPhone.includes(term));
      const usagesMatch = item.usages?.some((u) =>
        (u.clientName && u.clientName.toLowerCase().includes(term)) ||
        (u.clientEmail && u.clientEmail.toLowerCase().includes(term)) ||
        (u.clientPhone && u.clientPhone.includes(term)) ||
        (u.requestNumber && String(u.requestNumber).includes(term))
      );

      return codeMatch || noteMatch || clientDirectMatch || usagesMatch;
    });

    // 2. Ordenamiento
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'OLDEST':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'CODE_ASC':
          return a.code.localeCompare(b.code, undefined, { sensitivity: 'base' });
        case 'CODE_DESC':
          return b.code.localeCompare(a.code, undefined, { sensitivity: 'base' });
        case 'MOST_USED':
          return (b.timesUsed || b.usages?.length || 0) - (a.timesUsed || a.usages?.length || 0);
        case 'RECENT':
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
  }, [items, statusFilter, searchTerm, sortBy]);

  return (
    <section
      className="maintenance-section w-full p-5 sm:p-6 rounded-[var(--radius-card)] border border-border bg-card space-y-5"
      aria-labelledby="discounts-title"
    >
      {/* Cabecera de la tarjeta */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-border">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Tag size={20} className="text-gold shrink-0" />
            <h2 id="discounts-title" className="text-lg font-semibold tracking-tight text-foreground">
              Descuentos y Beneficios
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Gestión integral de códigos de beneficio para reservas: un solo uso y reutilizables, vigencias configurables y auditoría.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadCodes()}
            disabled={loading}
            className="v2-secondary min-h-[38px] text-xs"
            aria-label="Actualizar códigos"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin shrink-0' : 'shrink-0'} />
            <span className="hidden sm:inline">Actualizar</span>
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setCreateOpen(true);
              setCreatedItem(null);
              setCreateError('');
              setSelectedUsageMode('SINGLE_USE');
              setSelectedValidityType('NO_EXPIRATION');
              setCreateStartDate(getBuenosAiresTodayDateString());
              setCreateEndDate('');
              setCreateDurationValue(7);
              setCreateDurationUnit('DAYS');
            }}
            className="action-brand min-h-[38px] text-xs font-semibold"
          >
            <Plus size={16} className="shrink-0" />
            <span>Generar código</span>
          </Button>
        </div>
      </div>

      {/* Manejo de estado de error */}
      {error ? (
        <div className="p-6 rounded-lg border border-destructive/30 bg-destructive/10 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-destructive font-medium text-sm">
            <AlertCircle size={20} className="shrink-0" />
            <span>Error al consultar los códigos de beneficio</span>
          </div>
          <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
            {error.includes('UNAUTHORIZED_ADMIN_ONLY') || error.includes('AUTH_REQUIRED')
              ? 'No se pudieron consultar los códigos porque la sesión no cuenta con permisos de administrador activos o el token es inválido.'
              : error}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadCodes()}
            disabled={loading}
            className="mt-2 text-xs v2-secondary"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin mr-1.5' : 'mr-1.5'} />
            Reintentar
          </Button>
        </div>
      ) : (
        <>
          {/* Barra de herramientas: Buscador + Filtro Estado + Orden */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-end gap-3 w-full">
            {/* Buscador de texto */}
            <div className="flex-1 min-w-0">
              <label htmlFor="benefit-search" className="block text-xs font-medium text-muted-foreground mb-1.5">
                Buscar código o cliente
              </label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  id="benefit-search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por código, cliente o nota…"
                  className="pl-8 text-xs h-10 w-full bg-background"
                />
              </div>
            </div>

            {/* Selector de Estado */}
            <div className="w-full lg:w-56 shrink-0">
              <label htmlFor="benefit-status-filter" className="block text-xs font-medium text-muted-foreground mb-1.5">
                Estado
              </label>
              <select
                id="benefit-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="h-10 w-full px-3 text-xs bg-background border border-input rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
              >
                <option value="ALL">Todos ({statusCounts.ALL})</option>
                <option value="ACTIVE">Activos ({statusCounts.ACTIVE})</option>
                <option value="SCHEDULED">Programados ({statusCounts.SCHEDULED})</option>
                <option value="DISABLED">Desactivados ({statusCounts.DISABLED})</option>
                <option value="EXPIRED">Vencidos ({statusCounts.EXPIRED})</option>
                <option value="CONSUMED">Consumidos ({statusCounts.CONSUMED})</option>
                <option value="DELETED">Eliminados ({statusCounts.DELETED})</option>
              </select>
            </div>

            {/* Selector Ordenar por */}
            <div className="w-full lg:w-48 shrink-0">
              <label htmlFor="benefit-sort-order" className="block text-xs font-medium text-muted-foreground mb-1.5">
                Ordenar por
              </label>
              <select
                id="benefit-sort-order"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as BenefitCodeSortOption)}
                className="h-10 w-full px-3 text-xs bg-background border border-input rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
              >
                <option value="RECENT">Más recientes</option>
                <option value="OLDEST">Más antiguos</option>
                <option value="MOST_USED">Más utilizados</option>
                <option value="CODE_ASC">Nombre A-Z</option>
                <option value="CODE_DESC">Nombre Z-A</option>
              </select>
            </div>
          </div>

          {/* Lista de Códigos / Estado de Carga / Estado Vacío */}
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <RefreshCw size={24} className="animate-spin text-gold" />
              <span className="text-xs">Cargando códigos de beneficios…</span>
            </div>
          ) : filteredAndSortedItems.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-border rounded-lg p-6 bg-muted/20">
              <Gift size={32} className="mx-auto text-muted-foreground/60 mb-2" />
              <p className="text-sm font-medium text-foreground">No se encontraron códigos</p>
              <p className="text-xs text-muted-foreground mt-1">
                {searchTerm || statusFilter !== 'ALL'
                  ? 'Probá ajustando los filtros de búsqueda o estado.'
                  : 'Generá el primer código de beneficio para una reserva.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAndSortedItems.map((item) => {
                const def = BENEFIT_TYPE_DEFINITIONS[item.type];
                const isReusable = item.usageMode === 'REUSABLE';
                const status = item.status;
                const isCopied = copiedCode === item.code;
                const isExpanded = expandedCodeIds.has(item.id);

                // Conteo de reservas asociadas
                const usagesList = item.usages || [];
                const usageCount = item.timesUsed ?? usagesList.length;

                return (
                  <div
                    key={item.id}
                    className={`p-4 rounded-lg border transition-colors space-y-3 ${
                      status === 'DELETED'
                        ? 'bg-muted/30 border-dashed border-border/80 opacity-75'
                        : 'bg-background/50 hover:bg-background/80 border-border'
                    }`}
                  >
                    {/* Barra superior de la tarjeta */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span
                          className={`font-mono text-base font-bold tracking-wider select-all px-2.5 py-1 rounded border ${
                            status === 'DELETED'
                              ? 'line-through text-muted-foreground bg-muted border-border'
                              : 'text-foreground bg-muted/50 border-border/80'
                          }`}
                        >
                          {item.code}
                        </span>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleCopy(item.code)}
                          className="h-8 px-2 text-xs text-gold hover:text-gold/80"
                          title="Copiar código"
                        >
                          {isCopied ? (
                            <>
                              <Check size={14} className="text-green-500 mr-1" />
                              <span className="text-green-500 font-semibold">¡Copiado!</span>
                            </>
                          ) : (
                            <>
                              <Copy size={14} className="mr-1" />
                              <span>Copiar</span>
                            </>
                          )}
                        </Button>

                        {/* Badge de Modalidad de Uso */}
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${
                            isReusable
                              ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                              : 'bg-zinc-500/10 text-zinc-300 border-zinc-500/30'
                          }`}
                        >
                          {isReusable ? 'Reutilizable' : 'Un solo uso'}
                        </span>

                        {/* Badge de Tipo de Beneficio */}
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${
                            item.type === 'FREE_SERVICE'
                              ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                              : item.type === 'NO_DEPOSIT'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                              : 'bg-gold/10 text-gold border-gold/30'
                          }`}
                        >
                          {def.shortLabel}
                        </span>
                      </div>

                      {/* Badge de Estado y Acciones Rápidas */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Estado Administrativo */}
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                            status === 'ACTIVE'
                              ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                              : status === 'SCHEDULED'
                              ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                              : status === 'EXPIRED'
                              ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                              : status === 'CONSUMED'
                              ? 'bg-muted text-muted-foreground border-border'
                              : status === 'DELETED'
                              ? 'bg-destructive/10 text-destructive/80 border-destructive/20'
                              : 'bg-destructive/10 text-destructive border-destructive/30'
                          }`}
                        >
                          {status === 'ACTIVE' && <Check size={12} />}
                          {status === 'SCHEDULED' && <Clock size={12} />}
                          {status === 'EXPIRED' && <AlertTriangle size={12} />}
                          {status === 'CONSUMED' && <UserCheck size={12} />}
                          {status === 'DISABLED' && <Ban size={12} />}
                          {status === 'DELETED' && <Trash2 size={12} />}
                          <span>
                            {status === 'ACTIVE'
                              ? 'Activo'
                              : status === 'SCHEDULED'
                              ? 'Programado'
                              : status === 'EXPIRED'
                              ? 'Vencido'
                              : status === 'CONSUMED'
                              ? 'Consumido'
                              : status === 'DELETED'
                              ? 'Eliminado'
                              : 'Desactivado'}
                          </span>
                        </span>

                        {/* Indicador transitorio si un código de un solo uso está en checkout */}
                        {item.isLockedInCheckout && status === 'ACTIVE' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30 animate-pulse">
                            En checkout
                          </span>
                        )}

                        {/* Botones de Gestión (solo códigos no eliminados) */}
                        {status !== 'DELETED' && (
                          <div className="flex items-center gap-1.5">
                            {/* Activar / Desactivar */}
                            {status === 'ACTIVE' || status === 'SCHEDULED' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCodeToToggle({ item, targetActive: false })}
                                className="h-8 text-xs text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                                title="Desactivar este código"
                              >
                                <XCircle size={14} className="mr-1" />
                                <span>Desactivar</span>
                              </Button>
                            ) : status === 'DISABLED' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  // Si venció, advertir al usuario que primero debe actualizar la vigencia
                                  if (item.validUntil && new Date(item.validUntil).getTime() < Date.now()) {
                                    setCodeToToggle({ item, targetActive: true });
                                    setToggleStatusError(
                                      'Este código se encuentra vencido. Para activarlo nuevamente, primero debés actualizar su vigencia.'
                                    );
                                  } else {
                                    setCodeToToggle({ item, targetActive: true });
                                    setToggleStatusError('');
                                  }
                                }}
                                className="h-8 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                                title="Activar este código"
                              >
                                <Check size={14} className="mr-1" />
                                <span>Activar</span>
                              </Button>
                            ) : null}

                            {/* Editar vigencia (para reutilizables o para reactivar vencidos) */}
                            {isReusable && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditValidityOpen(item)}
                                className="h-8 text-xs text-gold hover:text-gold/80 hover:bg-gold/10"
                                title="Editar vigencia del código reutilizable"
                              >
                                <Edit2 size={13} className="mr-1" />
                                <span>Editar vigencia</span>
                              </Button>
                            )}

                            {/* Eliminar (Soft delete) */}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setCodeToDelete(item);
                                setDeleteError('');
                              }}
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              title="Eliminar código (conserva historial)"
                              aria-label={`Eliminar código ${item.code}`}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Fila de detalles: Tipo, Vigencia, Contador de usos y Auditoría */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs text-muted-foreground pt-1 border-t border-border/50">
                      <div>
                        <span className="block font-medium text-foreground">{def.label}</span>
                        <span className="text-[11px] text-muted-foreground">{def.description}</span>
                      </div>

                      {/* Vigencia */}
                      <div>
                        <span className="block text-muted-foreground">Vigencia:</span>
                        <span className="text-foreground font-medium block">
                          {item.validityType === 'NO_EXPIRATION' || !item.validUntil
                            ? 'Sin vencimiento'
                            : `Hasta ${formatBuenosAiresDate(item.validUntil)} (23:59 hs)`}
                        </span>
                        {item.validFrom && new Date(item.validFrom).getTime() > Date.now() && (
                          <span className="text-[11px] text-sky-400 block">
                            Inicia el {formatBuenosAiresDate(item.validFrom)}
                          </span>
                        )}
                      </div>

                      {/* Contador de usos */}
                      <div>
                        <span className="block text-muted-foreground">Cantidad de usos:</span>
                        <span className="text-foreground font-semibold flex items-center gap-1.5">
                          <Users size={13} className="text-gold" />
                          <span>
                            {usageCount === 1 ? '1 reserva' : `${usageCount} reservas`}
                          </span>
                        </span>
                      </div>

                      {/* Auditoría */}
                      <div>
                        <span className="block text-muted-foreground">Auditoría:</span>
                        <span className="text-foreground text-[11px] block">
                          Creado por {item.createdByDisplayName || 'Administrador'} el {formatBuenosAiresDate(item.createdAt)}
                        </span>
                        {item.lastEditedAt && (
                          <span className="text-muted-foreground text-[10px] block">
                            Modificado por {item.lastEditedByDisplayName || 'Administrador'} el {formatBuenosAiresDate(item.lastEditedAt)}
                          </span>
                        )}
                        {item.deletedAt && (
                          <span className="text-destructive text-[10px] block font-medium">
                            Eliminado por {item.deletedByDisplayName || 'Administrador'} el {formatBuenosAiresDate(item.deletedAt)}
                          </span>
                        )}
                      </div>

                      {item.internalNote && (
                        <div className="sm:col-span-2 lg:col-span-4 pt-1">
                          <span className="text-muted-foreground text-[11px]">Nota interna: </span>
                          <span className="text-foreground italic text-[11px]">{item.internalNote}</span>
                        </div>
                      )}
                    </div>

                    {/* Detalle directo de consumo para códigos de Un solo uso */}
                    {!isReusable && (usageCount > 0 || status === 'CONSUMED' || !!item.clientName || !!item.consumedAt) && (
                      <div className="mt-2 pt-2 border-t border-border/40">
                        {usagesList.length > 0 ? (
                          <div className="p-3 rounded-md bg-muted/30 border border-border text-xs space-y-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <UserCheck size={14} className="text-gold shrink-0" />
                                <strong className="text-foreground">{usagesList[0].clientName || 'Cliente'}</strong>
                                {usagesList[0].clientPhone && <span>· {usagesList[0].clientPhone}</span>}
                                {usagesList[0].clientEmail && <span className="text-muted-foreground">({usagesList[0].clientEmail})</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                {usagesList[0].requestNumber && (
                                  <span className="text-muted-foreground font-mono">
                                    Turno #{usagesList[0].requestNumber}
                                  </span>
                                )}
                                <span className="text-muted-foreground">
                                  ({usagesList[0].bookingDate} {usagesList[0].bookingTime})
                                </span>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                              <span>
                                Servicio: <strong className="text-foreground">{formatServiceName(usagesList[0].serviceName)}</strong> con{' '}
                                <strong className="text-foreground">{usagesList[0].barberName}</strong>
                              </span>
                              {usagesList[0].isAppointmentCancelled && (
                                <span className="px-1.5 py-0.5 rounded bg-destructive/15 text-destructive border border-destructive/30 font-semibold">
                                  Reserva cancelada
                                </span>
                              )}
                            </div>

                            {usagesList[0].finalPriceArs !== null && usagesList[0].finalPriceArs !== undefined && (
                              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground pt-0.5">
                                <span>Original: <strong className="text-foreground">{money(usagesList[0].originalPriceArs ?? 0)}</strong></span>
                                {item.type !== 'NO_DEPOSIT' && (
                                  <span>Descuento: <strong className="text-gold">−{money(usagesList[0].discountAmountArs ?? 0)}</strong></span>
                                )}
                                <span>Total final: <strong className="text-foreground">{money(usagesList[0].finalPriceArs)}</strong></span>
                                <span>Seña: <strong className="text-gold">{money(usagesList[0].onlineDepositArs ?? 0)}</strong></span>
                                <span>Saldo local: <strong className="text-foreground">{money(usagesList[0].inPersonBalanceArs ?? 0)}</strong></span>
                              </div>
                            )}
                          </div>
                        ) : (
                          // Fallback de snapshot compatible para códigos previos
                          <div className="p-3 rounded-md bg-muted/30 border border-border text-xs space-y-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <UserCheck size={14} className="text-gold shrink-0" />
                                <strong className="text-foreground">{item.clientName || 'Cliente'}</strong>
                                {item.clientPhone && <span>· {item.clientPhone}</span>}
                              </div>
                              {item.appointmentRequestNumber && (
                                <span className="text-muted-foreground font-mono">
                                  Turno #{item.appointmentRequestNumber} ({item.appointmentDate} {item.appointmentTime})
                                </span>
                              )}
                            </div>
                            {item.finalPriceArs !== null && item.finalPriceArs !== undefined && (
                              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                                <span>Original: <strong className="text-foreground">{money(item.originalPriceArs ?? 0)}</strong></span>
                                <span>Total: <strong className="text-foreground">{money(item.finalPriceArs)}</strong></span>
                                <span>Seña: <strong className="text-gold">{money(item.onlineDepositArs ?? 0)}</strong></span>
                                <span>Saldo: <strong className="text-foreground">{money(item.inPersonBalanceArs ?? 0)}</strong></span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Acordeón / Historial detallado de turnos asociados para códigos Reutilizables */}
                    {isReusable && usageCount > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/40">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleAccordion(item.id)}
                          className="h-8 text-xs text-gold hover:text-gold/80 px-2 py-1 flex items-center gap-1.5"
                        >
                          <Users size={13} />
                          <span>
                            {isExpanded
                              ? `Ocultar reservas asociadas (${usageCount})`
                              : `Ver reservas asociadas (${usageCount})`}
                          </span>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </Button>

                        {isExpanded && (
                          <div className="mt-2 space-y-2">
                            {usagesList.length > 0 ? (
                              usagesList.map((u) => (
                                <div
                                  key={u.id}
                                  className="p-3 rounded-md bg-muted/30 border border-border text-xs space-y-1.5"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <UserCheck size={14} className="text-gold shrink-0" />
                                      <strong className="text-foreground">{u.clientName || 'Cliente'}</strong>
                                      {u.clientPhone && <span>· {u.clientPhone}</span>}
                                      {u.clientEmail && <span className="text-muted-foreground">({u.clientEmail})</span>}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {u.requestNumber && (
                                        <span className="text-muted-foreground font-mono">
                                          Turno #{u.requestNumber}
                                        </span>
                                      )}
                                      <span className="text-muted-foreground">
                                        ({u.bookingDate} {u.bookingTime})
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                                    <span>
                                      Servicio: <strong className="text-foreground">{formatServiceName(u.serviceName)}</strong> con{' '}
                                      <strong className="text-foreground">{u.barberName}</strong>
                                    </span>
                                    {u.isAppointmentCancelled && (
                                      <span className="px-1.5 py-0.5 rounded bg-destructive/15 text-destructive border border-destructive/30 font-semibold">
                                        Reserva cancelada
                                      </span>
                                    )}
                                  </div>

                                  {u.finalPriceArs !== null && u.finalPriceArs !== undefined && (
                                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground pt-0.5">
                                      <span>Original: <strong className="text-foreground">{money(u.originalPriceArs ?? 0)}</strong></span>
                                      {item.type !== 'NO_DEPOSIT' && (
                                        <span>Descuento: <strong className="text-gold">−{money(u.discountAmountArs ?? 0)}</strong></span>
                                      )}
                                      <span>Total final: <strong className="text-foreground">{money(u.finalPriceArs)}</strong></span>
                                      <span>Seña: <strong className="text-gold">{money(u.onlineDepositArs ?? 0)}</strong></span>
                                      <span>Saldo local: <strong className="text-foreground">{money(u.inPersonBalanceArs ?? 0)}</strong></span>
                                    </div>
                                  )}
                                </div>
                              ))
                            ) : null}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ==============================================================================
          MODAL 1: GENERAR CÓDIGO (VIEWPORT-SAFE Y CAMPOS PROGRESIVOS)
         ============================================================================== */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          overlayClassName="benefit-code-dialog-overlay"
          className="benefit-code-dialog-content sm:max-w-lg"
        >
          <div className="benefit-code-dialog-header">
            <DialogTitle className="text-lg font-semibold flex items-center gap-2">
              <Sparkles size={18} className="text-gold" />
              <span>Generar código de descuento</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Formulario de creación de código de beneficio y descuento
            </DialogDescription>
          </div>

          {createdItem ? (
            <div className="benefit-code-dialog-scroll-body">
              <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-center space-y-3">
                <p className="text-xs text-emerald-500 font-semibold uppercase tracking-wider">¡Código generado con éxito!</p>
                <p className="font-mono text-2xl font-bold tracking-wider text-foreground select-all bg-background py-2 px-3 rounded border border-emerald-500/40">
                  {createdItem.code}
                </p>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>
                    Modalidad: <strong className="text-foreground">{BENEFIT_USAGE_MODE_DEFINITIONS[createdItem.usageMode || selectedUsageMode].label}</strong>
                  </p>
                  <p>
                    Beneficio: <strong className="text-foreground">{BENEFIT_TYPE_DEFINITIONS[createdItem.type].label}</strong>
                  </p>
                  <p>
                    Vigencia: <strong className="text-foreground">{createValidityPreview.summary}</strong>
                  </p>
                </div>
                <div className="pt-2 flex justify-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => void handleCopy(createdItem.code)}
                    className="action-brand text-xs min-h-[38px]"
                  >
                    {copiedCode === createdItem.code ? <Check size={14} className="mr-1" /> : <Copy size={14} className="mr-1" />}
                    <span>{copiedCode === createdItem.code ? '¡Copiado!' : 'Copiar código'}</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCreatedItem(null);
                      setCreateOpen(false);
                    }}
                    className="v2-secondary text-xs min-h-[38px]"
                  >
                    Cerrar
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="benefit-code-dialog-form flex flex-col flex-1 min-h-0">
              <div className="benefit-code-dialog-scroll-body space-y-4">
                {/* 1. Modalidad de uso */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-foreground block">
                    Modalidad de uso:
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['SINGLE_USE', 'REUSABLE'] as const).map((mode) => {
                      const def = BENEFIT_USAGE_MODE_DEFINITIONS[mode];
                      const isSelected = selectedUsageMode === mode;
                      return (
                        <label
                          key={mode}
                          className={`flex flex-col p-2.5 rounded-lg border cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-gold/10 border-gold shadow-xs'
                              : 'bg-background border-border hover:bg-muted/40'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="usage_mode"
                              value={mode}
                              checked={isSelected}
                              onChange={() => setSelectedUsageMode(mode)}
                              className="accent-gold text-gold"
                            />
                            <span className="text-xs sm:text-sm font-semibold text-foreground">{def.label}</span>
                          </div>
                          <span className="text-[11px] text-muted-foreground mt-1 leading-snug">
                            {def.description}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Tipo de beneficio */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-foreground block">
                    Beneficio:
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {(['PERCENT_10', 'PERCENT_50', 'NO_DEPOSIT', 'FREE_SERVICE'] as const).map((t) => {
                      const d = BENEFIT_TYPE_DEFINITIONS[t];
                      const isSelected = selectedType === t;
                      return (
                        <label
                          key={t}
                          className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-gold/10 border-gold shadow-xs'
                              : 'bg-background border-border hover:bg-muted/40'
                          }`}
                        >
                          <input
                            type="radio"
                            name="benefit_type"
                            value={t}
                            checked={isSelected}
                            onChange={() => setSelectedType(t)}
                            className="mt-1 accent-gold text-gold"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-foreground">{d.label}</span>
                              <span className="text-[11px] font-semibold text-gold">{d.shortLabel}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{d.description}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Vigencia */}
                <div className="space-y-2 pt-1 border-t border-border/50">
                  <div className="flex items-center justify-between">
                    <label htmlFor="create-validity-type" className="text-xs font-semibold text-foreground block">
                      Vigencia:
                    </label>
                    <span className="text-[11px] text-muted-foreground">Hora de Buenos Aires (UTC-3)</span>
                  </div>

                  <select
                    id="create-validity-type"
                    value={selectedValidityType}
                    onChange={(e) => setSelectedValidityType(e.target.value as BenefitValidityType)}
                    className="h-10 w-full px-3 text-xs bg-background border border-input rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
                  >
                    <option value="NO_EXPIRATION">Sin vencimiento</option>
                    <option value="ONE_WEEK">Durante una semana (7 días)</option>
                    <option value="ONE_MONTH">Durante un mes (mes calendario)</option>
                    <option value="CUSTOM_DURATION">Duración personalizada (X días, semanas o meses)</option>
                    <option value="DATE_RANGE">Desde una fecha hasta otra</option>
                  </select>

                  {/* Campos progresivos según vigencia */}
                  {selectedValidityType !== 'NO_EXPIRATION' && (
                    <div className="p-3 rounded-lg bg-muted/30 border border-border space-y-3 mt-2">
                      {/* Fecha de inicio */}
                      <div>
                        <label htmlFor="create-start-date" className="text-xs font-medium text-foreground block mb-1">
                          Fecha de inicio:
                        </label>
                        <Input
                          id="create-start-date"
                          type="date"
                          value={createStartDate}
                          onChange={(e) => setCreateStartDate(e.target.value)}
                          className="text-xs bg-background h-9"
                        />
                      </div>

                      {/* Duración personalizada */}
                      {selectedValidityType === 'CUSTOM_DURATION' && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label htmlFor="create-duration-value" className="text-xs font-medium text-foreground block mb-1">
                              Cantidad:
                            </label>
                            <Input
                              id="create-duration-value"
                              type="number"
                              min={1}
                              max={365}
                              value={createDurationValue}
                              onChange={(e) => setCreateDurationValue(Math.max(1, parseInt(e.target.value, 10) || 1))}
                              className="text-xs bg-background h-9"
                            />
                          </div>
                          <div>
                            <label htmlFor="create-duration-unit" className="text-xs font-medium text-foreground block mb-1">
                              Unidad:
                            </label>
                            <select
                              id="create-duration-unit"
                              value={createDurationUnit}
                              onChange={(e) => setCreateDurationUnit(e.target.value as BenefitDurationUnit)}
                              className="h-9 w-full px-2 text-xs bg-background border border-input rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
                            >
                              <option value="DAYS">Días</option>
                              <option value="WEEKS">Semanas</option>
                              <option value="MONTHS">Meses</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {/* Rango de fechas */}
                      {selectedValidityType === 'DATE_RANGE' && (
                        <div>
                          <label htmlFor="create-end-date" className="text-xs font-medium text-foreground block mb-1">
                            Fecha de vencimiento (inclusive):
                          </label>
                          <Input
                            id="create-end-date"
                            type="date"
                            min={createStartDate}
                            value={createEndDate}
                            onChange={(e) => setCreateEndDate(e.target.value)}
                            className="text-xs bg-background h-9"
                            required
                          />
                        </div>
                      )}

                      {/* Preview calculado */}
                      <div className="pt-1 text-[11px] text-muted-foreground flex items-start gap-1.5 border-t border-border/40">
                        <Calendar size={13} className="text-gold shrink-0 mt-0.5" />
                        <span>{createValidityPreview.detail}</span>
                      </div>
                    </div>
                  )}

                  {/* Aclaración obligatoria del negocio */}
                  <div className="p-2 rounded bg-muted/40 border border-border/60 text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <HelpCircle size={13} className="text-gold shrink-0" />
                    <span>
                      <strong>Nota de vigencia:</strong> La vigencia determina cuándo puede confirmarse la reserva con el código, no la fecha del turno.
                    </span>
                  </div>
                </div>

                {/* 4. Nota interna (opcional) */}
                <div className="space-y-1.5">
                  <label htmlFor="create-internal-note" className="text-xs font-semibold text-foreground block">
                    Nota interna (opcional):
                  </label>
                  <Input
                    id="create-internal-note"
                    value={internalNote}
                    onChange={(e) => setInternalNote(e.target.value)}
                    placeholder="Ej: Cortesía por demora, influencer, campaña de fin de año…"
                    className="text-xs bg-background"
                    maxLength={250}
                  />
                </div>

                {/* 5. Código personalizado (opcional) */}
                <div className="space-y-1.5">
                  <label htmlFor="create-custom-code" className="text-xs font-semibold text-foreground block">
                    Código personalizado (opcional)
                  </label>
                  <Input
                    id="create-custom-code"
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                    placeholder="Ej: KANI-VIP-2026"
                    className="text-xs font-mono uppercase bg-background"
                    maxLength={32}
                  />
                  <span className="text-[11px] text-muted-foreground block">
                    Si se deja vacío, el sistema generará un código seguro e irrepetible.
                  </span>
                </div>

                {createError && (
                  <div className="p-2.5 rounded bg-destructive/10 text-destructive text-xs flex items-center gap-2">
                    <AlertCircle size={14} className="shrink-0" />
                    <span>{createError}</span>
                  </div>
                )}
              </div>

              <div className="benefit-code-dialog-footer">
                <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCreateOpen(false)}
                    disabled={creating}
                    className="v2-secondary min-h-[40px] text-xs"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={creating}
                    className="action-brand min-h-[40px] text-xs font-semibold"
                  >
                    {creating ? <RefreshCw size={14} className="animate-spin mr-1.5" /> : <Sparkles size={14} className="mr-1.5" />}
                    <span>{creating ? 'Generando…' : 'Crear código'}</span>
                  </Button>
                </DialogFooter>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ==============================================================================
          MODAL 2: EDITAR VIGENCIA (CÓDIGOS REUTILIZABLES)
         ============================================================================== */}
      <Dialog open={!!codeToEditValidity} onOpenChange={(open) => !editingValidity && !open && setCodeToEditValidity(null)}>
        <DialogContent
          overlayClassName="benefit-code-dialog-overlay"
          className="benefit-code-dialog-content sm:max-w-md"
        >
          <div className="benefit-code-dialog-header">
            <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <Edit2 size={16} className="text-gold shrink-0" />
              <span>Editar vigencia · {codeToEditValidity?.code}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              Modificá las fechas de vigencia del código reutilizable. Las reservas ya confirmadas mantendrán sus condiciones originales intactas.
            </DialogDescription>
          </div>

          <form onSubmit={handleEditValiditySubmit} className="benefit-code-dialog-form flex flex-col flex-1 min-h-0">
            <div className="benefit-code-dialog-scroll-body space-y-4">
              <div>
                <label htmlFor="edit-validity-type" className="text-xs font-semibold text-foreground block mb-1">
                  Opción de vigencia:
                </label>
                <select
                  id="edit-validity-type"
                  value={editValidityType}
                  onChange={(e) => setEditValidityType(e.target.value as BenefitValidityType)}
                  className="h-10 w-full px-3 text-xs bg-background border border-input rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
                >
                  <option value="NO_EXPIRATION">Sin vencimiento</option>
                  <option value="ONE_WEEK">Durante una semana (7 días)</option>
                  <option value="ONE_MONTH">Durante un mes (mes calendario)</option>
                  <option value="CUSTOM_DURATION">Duración personalizada (X días, semanas o meses)</option>
                  <option value="DATE_RANGE">Desde una fecha hasta otra</option>
                </select>
              </div>

              {editValidityType !== 'NO_EXPIRATION' && (
                <div className="p-3 rounded-lg bg-muted/30 border border-border space-y-3">
                  <div>
                    <label htmlFor="edit-start-date" className="text-xs font-medium text-foreground block mb-1">
                      Fecha de inicio:
                    </label>
                    <Input
                      id="edit-start-date"
                      type="date"
                      value={editStartDate}
                      onChange={(e) => setEditStartDate(e.target.value)}
                      className="text-xs bg-background h-9"
                    />
                  </div>

                  {editValidityType === 'CUSTOM_DURATION' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="edit-duration-value" className="text-xs font-medium text-foreground block mb-1">
                          Cantidad:
                        </label>
                        <Input
                          id="edit-duration-value"
                          type="number"
                          min={1}
                          max={365}
                          value={editDurationValue}
                          onChange={(e) => setEditDurationValue(Math.max(1, parseInt(e.target.value, 10) || 1))}
                          className="text-xs bg-background h-9"
                        />
                      </div>
                      <div>
                        <label htmlFor="edit-duration-unit" className="text-xs font-medium text-foreground block mb-1">
                          Unidad:
                        </label>
                        <select
                          id="edit-duration-unit"
                          value={editDurationUnit}
                          onChange={(e) => setEditDurationUnit(e.target.value as BenefitDurationUnit)}
                          className="h-9 w-full px-2 text-xs bg-background border border-input rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
                        >
                          <option value="DAYS">Días</option>
                          <option value="WEEKS">Semanas</option>
                          <option value="MONTHS">Meses</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {editValidityType === 'DATE_RANGE' && (
                    <div>
                      <label htmlFor="edit-end-date" className="text-xs font-medium text-foreground block mb-1">
                        Fecha de vencimiento:
                      </label>
                      <Input
                        id="edit-end-date"
                        type="date"
                        min={editStartDate}
                        value={editEndDate}
                        onChange={(e) => setEditEndDate(e.target.value)}
                        className="text-xs bg-background h-9"
                        required
                      />
                    </div>
                  )}

                  <div className="pt-1 text-[11px] text-muted-foreground flex items-start gap-1.5 border-t border-border/40">
                    <Calendar size={13} className="text-gold shrink-0 mt-0.5" />
                    <span>{editValidityPreview.detail}</span>
                  </div>
                </div>
              )}

              {editValidityError && (
                <div className="p-2.5 rounded bg-destructive/10 text-destructive text-xs flex items-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{editValidityError}</span>
                </div>
              )}
            </div>

            <div className="benefit-code-dialog-footer">
              <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCodeToEditValidity(null)}
                  disabled={editingValidity}
                  className="v2-secondary min-h-[40px] text-xs"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={editingValidity}
                  className="action-brand min-h-[40px] text-xs font-semibold"
                >
                  {editingValidity ? <RefreshCw size={14} className="animate-spin mr-1.5" /> : <Check size={14} className="mr-1.5" />}
                  <span>{editingValidity ? 'Guardando…' : 'Guardar vigencia'}</span>
                </Button>
              </DialogFooter>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ==============================================================================
          MODAL 3: ACTIVAR / DESACTIVAR
         ============================================================================== */}
      <Dialog
        open={!!codeToToggle}
        onOpenChange={(open) => !togglingStatus && !open && setCodeToToggle(null)}
      >
        <DialogContent
          overlayClassName="benefit-code-dialog-overlay"
          className="benefit-code-dialog-content sm:max-w-md"
        >
          <div className="benefit-code-dialog-header">
            <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              {codeToToggle?.targetActive ? (
                <>
                  <Check size={18} className="text-emerald-400 shrink-0" />
                  <span>¿Activar código {codeToToggle?.item.code}?</span>
                </>
              ) : (
                <>
                  <Ban size={18} className="text-destructive shrink-0" />
                  <span>¿Desactivar código {codeToToggle?.item.code}?</span>
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm text-muted-foreground leading-relaxed mt-1.5">
              {codeToToggle?.targetActive
                ? 'El código volverá a estar disponible para reservas según sus condiciones de vigencia.'
                : 'El código no podrá ser utilizado para nuevas reservas mientras esté desactivado. Esta acción no modifica reservas ya confirmadas.'}
            </DialogDescription>
          </div>

          <div className="benefit-code-dialog-scroll-body">
            {toggleStatusError && (
              <div className="p-3 rounded bg-destructive/10 text-destructive text-xs space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle size={15} className="shrink-0 mt-0.5" />
                  <span>{toggleStatusError}</span>
                </div>
                {codeToToggle?.targetActive &&
                  codeToToggle.item.validUntil &&
                  new Date(codeToToggle.item.validUntil).getTime() < Date.now() && (
                    <Button
                      size="sm"
                      onClick={() => {
                        const it = codeToToggle.item;
                        setCodeToToggle(null);
                        handleEditValidityOpen(it);
                      }}
                      className="action-brand text-xs min-h-[34px] w-full mt-1 font-semibold"
                    >
                      <Edit2 size={13} className="mr-1" />
                      <span>Actualizar vigencia ahora</span>
                    </Button>
                  )}
              </div>
            )}
          </div>

          <div className="benefit-code-dialog-footer">
            <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setCodeToToggle(null)}
                disabled={togglingStatus}
                className="v2-secondary min-h-[40px] text-xs"
              >
                Cancelar
              </Button>
              {/* Si está vencido y no se puede activar, solo permitir cerrar o ir a editar */}
              {!(
                codeToToggle?.targetActive &&
                codeToToggle.item.validUntil &&
                new Date(codeToToggle.item.validUntil).getTime() < Date.now()
              ) && (
                <Button
                  onClick={handleToggleConfirm}
                  disabled={togglingStatus}
                  className={`action-brand min-h-[40px] text-xs font-semibold ${
                    !codeToToggle?.targetActive ? 'v2-destructive' : ''
                  }`}
                >
                  {togglingStatus ? (
                    <RefreshCw size={14} className="animate-spin mr-1.5" />
                  ) : codeToToggle?.targetActive ? (
                    <Check size={14} className="mr-1.5" />
                  ) : (
                    <Ban size={14} className="mr-1.5" />
                  )}
                  <span>
                    {togglingStatus
                      ? 'Procesando…'
                      : codeToToggle?.targetActive
                      ? 'Confirmar activación'
                      : 'Confirmar desactivación'}
                  </span>
                </Button>
              )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ==============================================================================
          MODAL 4: ELIMINAR (SOFT DELETE)
         ============================================================================== */}
      <Dialog
        open={!!codeToDelete}
        onOpenChange={(open) => !deleting && !open && setCodeToDelete(null)}
      >
        <DialogContent
          overlayClassName="benefit-code-dialog-overlay"
          className="benefit-code-dialog-content sm:max-w-md"
        >
          <div className="benefit-code-dialog-header">
            <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <Trash2 size={18} className="text-destructive shrink-0" />
              <span>¿Eliminar código {codeToDelete?.code}?</span>
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm text-muted-foreground leading-relaxed mt-1.5">
              Esta acción retirará el código de uso y del listado habitual. Su historial y reservas vinculadas se conservarán de forma permanente. Por seguridad contable, el texto identificador no podrá volver a reutilizarse.
            </DialogDescription>
          </div>

          <div className="benefit-code-dialog-scroll-body">
            {deleteError && (
              <div className="p-2.5 rounded bg-destructive/10 text-destructive text-xs flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}
          </div>

          <div className="benefit-code-dialog-footer">
            <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setCodeToDelete(null)}
                disabled={deleting}
                className="v2-secondary min-h-[40px] text-xs"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="v2-destructive action-brand min-h-[40px] text-xs font-semibold"
              >
                {deleting ? <RefreshCw size={14} className="animate-spin mr-1.5" /> : <Trash2 size={14} className="mr-1.5" />}
                <span>{deleting ? 'Eliminando…' : 'Confirmar eliminación'}</span>
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
