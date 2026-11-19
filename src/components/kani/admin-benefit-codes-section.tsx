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
  FileText,
  Gift,
  HelpCircle,
  History,
  Info,
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
  KaniModalClose,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import '@/components/kani/v2/discount-card.css';

export type BenefitCodeSortOption = 'RECENT' | 'OLDEST' | 'CODE_ASC' | 'CODE_DESC' | 'MOST_USED';

function getBenefitHeadline(type: BenefitCodeType): string {
  switch (type) {
    case 'PERCENT_10':
      return '10% de descuento';
    case 'PERCENT_50':
      return '50% de descuento';
    case 'FREE_SERVICE':
      return 'Servicio gratuito';
    case 'NO_DEPOSIT':
      return 'Reserva sin seña';
    default:
      return BENEFIT_TYPE_DEFINITIONS[type]?.label ?? type;
  }
}

function getStatusDisplay(status: BenefitCodeStatus): {
  badgeLabel: string;
  badgeClass: string;
  fullDescription: string;
} {
  switch (status) {
    case 'ACTIVE':
      return {
        badgeLabel: 'Activo',
        badgeClass: 'is-active',
        fullDescription: 'Activo y disponible para reservas',
      };
    case 'SCHEDULED':
      return {
        badgeLabel: 'Programado',
        badgeClass: 'is-scheduled',
        fullDescription: 'Programado para habilitarse en su fecha de inicio',
      };
    case 'DISABLED':
      return {
        badgeLabel: 'Inactivo',
        badgeClass: 'is-inactive',
        fullDescription: 'Inactivo · Desactivado manualmente por un administrador',
      };
    case 'EXPIRED':
      return {
        badgeLabel: 'Vencido',
        badgeClass: 'is-expired',
        fullDescription: 'Vencido · Fuera de su período de vigencia',
      };
    case 'CONSUMED':
      return {
        badgeLabel: 'Consumido',
        badgeClass: 'is-consumed',
        fullDescription: 'Consumido · Código de un solo uso ya utilizado',
      };
    case 'DELETED':
      return {
        badgeLabel: 'Eliminado',
        badgeClass: 'is-deleted',
        fullDescription: 'Eliminado · Retirado de uso (conservado para auditoría)',
      };
    default:
      return {
        badgeLabel: 'Inactivo',
        badgeClass: 'is-inactive',
        fullDescription: 'En proceso de checkout',
      };
  }
}

function getCompactValidityText(item: BenefitCodeItem): string {
  if (item.status === 'SCHEDULED' && item.validFrom) {
    return item.validUntil
      ? `Desde ${formatBuenosAiresDate(item.validFrom)} · Hasta ${formatBuenosAiresDate(item.validUntil)}`
      : `Desde ${formatBuenosAiresDate(item.validFrom)}`;
  }
  if (item.validityType === 'NO_EXPIRATION' || !item.validUntil) {
    return 'Sin vencimiento';
  }
  return `Hasta ${formatBuenosAiresDate(item.validUntil)}`;
}

export function BenefitCodesAdminSection({ hideHeading = false }: { hideHeading?: boolean } = {}) {
  const [items, setItems] = useState<BenefitCodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | BenefitCodeStatus>('ALL');
  const [sortBy, setSortBy] = useState<BenefitCodeSortOption>('RECENT');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedCodeIds, setExpandedCodeIds] = useState<Set<string>>(new Set());
  const [openSubSectionMap, setOpenSubSectionMap] = useState<
    Record<string, 'conditions' | 'admin' | 'history' | null>
  >({});

  const toggleSubSection = (codeId: string, section: 'conditions' | 'admin' | 'history') => {
    setOpenSubSectionMap((prev) => ({
      ...prev,
      [codeId]: prev[codeId] === section ? null : section,
    }));
  };

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

  const openDeleteConfirm = (item: BenefitCodeItem) => {
    setCodeToDelete(item);
    setDeleteError('');
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

  const openCreateDialog = () => {
    setCreateOpen(true);
    setCreatedItem(null);
    setCreateError('');
    setSelectedUsageMode('SINGLE_USE');
    setSelectedValidityType('NO_EXPIRATION');
    setCreateStartDate(getBuenosAiresTodayDateString());
    setCreateEndDate('');
    setCreateDurationValue(7);
    setCreateDurationUnit('DAYS');
  };

  return (
    <section
      className="maintenance-section w-full p-5 sm:p-6 rounded-[var(--radius-card)] border border-border bg-card space-y-5"
      aria-labelledby={hideHeading ? undefined : 'discounts-title'}
      aria-label={hideHeading ? 'Códigos de descuento y beneficio' : undefined}
    >
      {/* Cabecera opcional (se oculta en /admin-liquid/descuentos por V12.43) */}
      {!hideHeading && (
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
          <div className="flex items-center gap-2 shrink-0 kani-dtoolbar-header-actions">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadCodes()}
              disabled={loading}
              className="v2-secondary kani-dtoolbar-refresh-btn min-h-[38px] text-xs"
              aria-label="Actualizar códigos"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin shrink-0' : 'shrink-0'} />
              <span className="hidden sm:inline">Actualizar</span>
            </Button>
            <Button
              size="sm"
              onClick={openCreateDialog}
              className="action-brand kani-dtoolbar-generate-btn min-h-[38px] text-xs font-semibold"
            >
              <Plus size={16} className="shrink-0" />
              <span>Generar código</span>
            </Button>
          </div>
        </div>
      )}

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
          <div className="kani-dfilters flex flex-col lg:flex-row items-stretch lg:items-end gap-3 w-full">
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
                <option value="CODE_ASC">Nombre A-Z</option>
                <option value="CODE_DESC">Nombre Z-A</option>
                <option value="MOST_USED">Más utilizados</option>
              </select>
            </div>
          </div>

          {/* Barra compacta de resultados y acciones principales (estilo Membresías) */}
          {hideHeading && (
            <div className="kani-dtoolbar">
              <span className="kani-dtoolbar-count">
                {filteredAndSortedItems.length === 1
                  ? '1 descuento encontrado'
                  : `${filteredAndSortedItems.length} descuentos encontrados`}
              </span>
              <div className="kani-dtoolbar-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadCodes()}
                  disabled={loading}
                  className="v2-secondary kani-dtoolbar-refresh-btn min-h-[38px] text-xs"
                  aria-label="Actualizar códigos"
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin shrink-0' : 'shrink-0'} />
                  <span>Actualizar</span>
                </Button>
                <Button
                  size="sm"
                  onClick={openCreateDialog}
                  className="action-brand kani-dtoolbar-generate-btn min-h-[38px] text-xs font-semibold"
                >
                  <Plus size={16} className="shrink-0" />
                  <span>Generar código</span>
                </Button>
              </div>
            </div>
          )}

          {/* Lista de Códigos / Estado de Carga / Estado Vacío */}
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <RefreshCw size={24} className="animate-spin text-gold" />
              <span className="text-xs">Cargando códigos de beneficios…</span>
            </div>
          ) : filteredAndSortedItems.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-border rounded-lg p-5 bg-muted/20">
              <Gift size={28} className="mx-auto text-muted-foreground/60 mb-2" />
              <p className="text-sm font-medium text-foreground">Sin códigos</p>
              <p className="text-xs text-muted-foreground mt-1">
                {searchTerm || statusFilter !== 'ALL'
                  ? 'No hay códigos para este filtro.'
                  : 'Generá el primer código de beneficio.'}
              </p>
            </div>
          ) : (
            <>
              <span className="sr-only" role="status" aria-live="polite">
                {copiedCode ? `Código copiado: ${copiedCode}` : ''}
              </span>
              <div className={`kani-dgrid${filteredAndSortedItems.length === 1 ? ' is-single' : ''}`}>
              {filteredAndSortedItems.map((item) => {
                const def = BENEFIT_TYPE_DEFINITIONS[item.type];
                const usageMode = item.usageMode || 'SINGLE_USE';
                const usageDef = BENEFIT_USAGE_MODE_DEFINITIONS[usageMode];
                const isReusable = usageMode === 'REUSABLE';
                const status = item.status;
                const statusDisplay = getStatusDisplay(status);
                const isCopied = copiedCode === item.code;
                const isExpanded = expandedCodeIds.has(item.id);
                const usagesList = item.usages || [];
                const usageCount = item.timesUsed ?? usagesList.length;
                const hasLegacyUsage =
                  !isReusable &&
                  (usageCount > 0 ||
                    status === 'CONSUMED' ||
                    !!item.clientName ||
                    !!item.consumedAt ||
                    !!item.appointmentRequestNumber);
                const extraAuditItem = item as BenefitCodeItem & {
                  changeReason?: string | null;
                  reason?: string | null;
                  lastEditedReason?: string | null;
                };
                const changeReason =
                  extraAuditItem.changeReason?.trim() ||
                  extraAuditItem.reason?.trim() ||
                  extraAuditItem.lastEditedReason?.trim() ||
                  null;
                const deactivationOrDeletionInfo =
                  status === 'DELETED' || item.deletedAt || item.deletedByDisplayName
                    ? `Eliminado${item.deletedByDisplayName ? ` por ${item.deletedByDisplayName}` : ''}${
                        item.deletedAt ? ` el ${formatBuenosAiresDateTime(item.deletedAt)}` : ''
                      }`
                    : status === 'DISABLED'
                    ? `Desactivado manualmente${
                        item.lastEditedByDisplayName ? ` por ${item.lastEditedByDisplayName}` : ''
                      }${item.lastEditedAt ? ` el ${formatBuenosAiresDateTime(item.lastEditedAt)}` : ''}`
                    : null;

                return (
                  <article
                    key={item.id}
                    className="kani-dcard"
                    data-testid={`discount-card-${item.id}`}
                    data-status={status}
                  >
                    <div className="kani-dcard-body">
                      {/* Nivel 1: Código + Copiar (ícono) + Estado único */}
                      <header className="kani-dcard-header">
                        <div className="kani-dcard-code-group">
                          <h3
                            className={`kani-dcard-code select-all${
                              status === 'DELETED' ? ' is-deleted' : ''
                            }`}
                          >
                            {item.code}
                          </h3>
                          <button
                            type="button"
                            className={`v2-secondary kani-dcard-btn-copy${isCopied ? ' is-copied' : ''}`}
                            aria-label={isCopied ? `Código copiado: ${item.code}` : `Copiar código ${item.code}`}
                            title={
                              status === 'DELETED'
                                ? 'Código eliminado'
                                : isCopied
                                ? 'Código copiado'
                                : 'Copiar código'
                            }
                            disabled={status === 'DELETED'}
                            onClick={() => void handleCopy(item.code)}
                          >
                            {isCopied ? (
                              <Check size={14} aria-hidden="true" />
                            ) : (
                              <Copy size={14} aria-hidden="true" />
                            )}
                          </button>
                        </div>

                        <span className={`kani-dcard-badge ${statusDisplay.badgeClass}`}>
                          {statusDisplay.badgeLabel}
                        </span>
                      </header>

                      {/* Nivel 2: Beneficio principal sin repeticiones */}
                      <div className="kani-dcard-benefit">{getBenefitHeadline(item.type)}</div>

                      {/* Nivel 3: Vigencia y Cantidad de usos */}
                      <div className="kani-dcard-meta">
                        <span className="kani-dcard-meta-item">
                          <Calendar size={14} aria-hidden="true" />
                          <span>{getCompactValidityText(item)}</span>
                        </span>
                        <span className="kani-dcard-meta-item">
                          <Users size={14} aria-hidden="true" />
                          <strong>{usageCount === 1 ? '1 uso' : `${usageCount} usos`}</strong>
                        </span>
                      </div>
                    </div>

                    {/* Nivel 4: Acciones */}
                    <div className="kani-dcard-actions">
                      <button
                        type="button"
                        className="v2-secondary kani-dcard-btn-details"
                        aria-expanded={isExpanded}
                        aria-controls={`discount-details-${item.id}`}
                        onClick={() => toggleAccordion(item.id)}
                      >
                        <span>Secciones</span>
                        {isExpanded ? (
                          <ChevronUp size={14} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={14} aria-hidden="true" />
                        )}
                      </button>

                      {status !== 'DELETED' && (
                        <>
                          {isReusable && (
                            <button
                              type="button"
                              className="v2-secondary kani-dcard-btn-action"
                              onClick={() => handleEditValidityOpen(item)}
                              title="Editar vigencia"
                            >
                              <Edit2 size={13} aria-hidden="true" />
                              <span>Editar</span>
                            </button>
                          )}

                          {status === 'ACTIVE' || status === 'SCHEDULED' ? (
                            <button
                              type="button"
                              className="v2-secondary kani-dcard-btn-action kani-dcard-btn-warning"
                              onClick={() => {
                                setToggleStatusError('');
                                setCodeToToggle({ item, targetActive: false });
                              }}
                              title="Desactivar este código"
                            >
                              <XCircle size={13} aria-hidden="true" />
                              <span>Desactivar</span>
                            </button>
                          ) : status === 'DISABLED' ? (
                            <button
                              type="button"
                              className="v2-secondary kani-dcard-btn-action kani-dcard-btn-activate"
                              onClick={() => {
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
                              title="Activar este código"
                            >
                              <Check size={13} aria-hidden="true" />
                              <span>Activar</span>
                            </button>
                          ) : null}

                          <button
                            type="button"
                            className="v2-secondary kani-dcard-btn-delete is-destructive"
                            onClick={() => openDeleteConfirm(item)}
                            title="Eliminar código (conserva historial)"
                            aria-label={`Eliminar código ${item.code}`}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>

                    {/* Nivel 5: Sección expandible "Secciones" (v2.4: 3 accordions exclusivos contraídos inicialmente) */}
                    {isExpanded && (() => {
                      const openSub = openSubSectionMap[item.id] ?? null;
                      return (
                      <div
                        id={`discount-details-${item.id}`}
                        className="kani-dcard-details"
                        data-testid={`discount-details-${item.id}`}
                      >
                        {/* A. Condiciones (contraída inicialmente) */}
                        <section
                          className={`kani-dcard-subgroup${openSub === 'conditions' ? ' is-open' : ''}`}
                          aria-label="Condiciones"
                        >
                          <button
                            type="button"
                            className="kani-dcard-subgroup-summary"
                            aria-expanded={openSub === 'conditions'}
                            aria-controls={`discount-sub-conditions-${item.id}`}
                            onClick={() => toggleSubSection(item.id, 'conditions')}
                          >
                            <span className="kani-dcard-subgroup-leading">
                              <FileText size={15} className="kani-dcard-subgroup-icon" aria-hidden="true" />
                              <span>Condiciones</span>
                            </span>
                            <ChevronDown size={14} className="kani-dcard-subgroup-chevron" aria-hidden="true" />
                          </button>
                          {openSub === 'conditions' && (
                            <dl
                              id={`discount-sub-conditions-${item.id}`}
                              className="kani-dcard-kv-grid kani-dcard-subgroup-body"
                            >
                              <div className="kani-dcard-kv is-full">
                                <dt className="kani-dcard-kv-label">Estado</dt>
                                <dd className="kani-dcard-kv-value">
                                  {status === 'ACTIVE'
                                    ? item.isLockedInCheckout
                                      ? 'Activo (en checkout)'
                                      : 'Activo'
                                    : statusDisplay.fullDescription}
                                </dd>
                              </div>

                              <div className="kani-dcard-kv is-full">
                                <dt className="kani-dcard-kv-label">Alcance y vigencia</dt>
                                <dd className="kani-dcard-kv-value">
                                  {usageDef.label} · {def.description}{' '}
                                  {item.validityType === 'NO_EXPIRATION' || !item.validUntil
                                    ? 'Sin vencimiento.'
                                    : `Hasta ${formatBuenosAiresDate(item.validUntil)} (23:59 hs).`}
                                </dd>
                              </div>

                              {item.internalNote ? (
                                <div className="kani-dcard-kv is-full">
                                  <dt className="kani-dcard-kv-label">Notas internas</dt>
                                  <dd className="kani-dcard-kv-value">{item.internalNote}</dd>
                                </div>
                              ) : null}
                            </dl>
                          )}
                        </section>

                        {/* B. Información administrativa (contraída inicialmente) */}
                        <section
                          className={`kani-dcard-subgroup${openSub === 'admin' ? ' is-open' : ''}`}
                          aria-label="Información administrativa"
                        >
                          <button
                            type="button"
                            className="kani-dcard-subgroup-summary"
                            aria-expanded={openSub === 'admin'}
                            aria-controls={`discount-sub-admin-${item.id}`}
                            onClick={() => toggleSubSection(item.id, 'admin')}
                          >
                            <span className="kani-dcard-subgroup-leading">
                              <Info size={15} className="kani-dcard-subgroup-icon" aria-hidden="true" />
                              <span>Información administrativa</span>
                            </span>
                            <ChevronDown size={14} className="kani-dcard-subgroup-chevron" aria-hidden="true" />
                          </button>
                          {openSub === 'admin' && (
                            <dl
                              id={`discount-sub-admin-${item.id}`}
                              className="kani-dcard-kv-grid kani-dcard-subgroup-body"
                            >
                              <div className="kani-dcard-kv">
                                <dt className="kani-dcard-kv-label">Creado el</dt>
                                <dd className="kani-dcard-kv-value">
                                  {item.createdAt ? formatBuenosAiresDateTime(item.createdAt) : 'Sin registro'}
                                </dd>
                              </div>

                              <div className="kani-dcard-kv">
                                <dt className="kani-dcard-kv-label">Creado por</dt>
                                <dd className="kani-dcard-kv-value">
                                  {item.createdByDisplayName || 'Sin registro'}
                                </dd>
                              </div>

                              {item.lastEditedAt ? (
                                <>
                                  <div className="kani-dcard-kv">
                                    <dt className="kani-dcard-kv-label">Última edición</dt>
                                    <dd className="kani-dcard-kv-value">
                                      {formatBuenosAiresDateTime(item.lastEditedAt)}
                                    </dd>
                                  </div>
                                  <div className="kani-dcard-kv">
                                    <dt className="kani-dcard-kv-label">Editado por</dt>
                                    <dd className="kani-dcard-kv-value">
                                      {item.lastEditedByDisplayName || 'Sin registro'}
                                    </dd>
                                  </div>
                                </>
                              ) : (
                                <div className="kani-dcard-kv is-full">
                                  <dt className="kani-dcard-kv-label">Modificaciones</dt>
                                  <dd className="kani-dcard-kv-value">Sin modificaciones</dd>
                                </div>
                              )}

                              {changeReason && (
                                <div className="kani-dcard-kv is-full">
                                  <dt className="kani-dcard-kv-label">Motivo</dt>
                                  <dd className="kani-dcard-kv-value">{changeReason}</dd>
                                </div>
                              )}

                              {deactivationOrDeletionInfo && (
                                <div className="kani-dcard-kv is-full">
                                  <dt className="kani-dcard-kv-label">
                                    {status === 'DELETED' || item.deletedAt
                                      ? 'Eliminación'
                                      : 'Desactivación'}
                                  </dt>
                                  <dd className="kani-dcard-kv-value">{deactivationOrDeletionInfo}</dd>
                                </div>
                              )}
                            </dl>
                          )}
                        </section>

                        {/* C. Historial de usos (contraída inicialmente) */}
                        <section
                          className={`kani-dcard-subgroup${openSub === 'history' ? ' is-open' : ''}`}
                          aria-label="Historial de usos"
                        >
                          <button
                            type="button"
                            className="kani-dcard-subgroup-summary"
                            aria-expanded={openSub === 'history'}
                            aria-controls={`discount-sub-history-${item.id}`}
                            onClick={() => toggleSubSection(item.id, 'history')}
                          >
                            <span className="kani-dcard-subgroup-leading">
                              <History size={15} className="kani-dcard-subgroup-icon" aria-hidden="true" />
                              <span>Historial de usos ({usageCount})</span>
                            </span>
                            <ChevronDown size={14} className="kani-dcard-subgroup-chevron" aria-hidden="true" />
                          </button>
                          {openSub === 'history' && (
                            <div
                              id={`discount-sub-history-${item.id}`}
                              className="kani-dcard-subgroup-body kani-dcard-usages"
                            >
                            {usagesList.length > 0 ? (
                              usagesList.map((u) => (
                                <div key={u.id} className="kani-dcard-usage-row">
                                  <div className="kani-dcard-usage-top">
                                    <div>
                                      <strong>{u.clientName || 'Cliente'}</strong>
                                      {u.clientPhone ? ` · ${u.clientPhone}` : ''}
                                      {u.clientEmail ? ` (${u.clientEmail})` : ''}
                                    </div>
                                    <div className="kani-dcard-usage-meta">
                                      {u.requestNumber ? `Turno #${u.requestNumber} · ` : ''}
                                      {u.bookingDate} {u.bookingTime}
                                    </div>
                                  </div>

                                  {(u.serviceName || u.barberName || u.isAppointmentCancelled) && (
                                    <div className="kani-dcard-usage-top">
                                      <span className="kani-dcard-usage-meta">
                                        {u.serviceName ? formatServiceName(u.serviceName) : 'Servicio'}
                                        {u.barberName ? ` con ${u.barberName}` : ''}
                                      </span>
                                      {u.isAppointmentCancelled && (
                                        <span className="kani-dcard-usage-cancelled">
                                          Reserva cancelada
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {u.finalPriceArs !== null && u.finalPriceArs !== undefined && (
                                    <div className="kani-dcard-usage-amounts">
                                      <span>
                                        Original: <strong>{money(u.originalPriceArs ?? 0)}</strong>
                                      </span>
                                      {item.type !== 'NO_DEPOSIT' && (
                                        <span>
                                          Descuento: <strong>−{money(u.discountAmountArs ?? 0)}</strong>
                                        </span>
                                      )}
                                      <span>
                                        Total: <strong>{money(u.finalPriceArs)}</strong>
                                      </span>
                                      <span>
                                        Seña: <strong>{money(u.onlineDepositArs ?? 0)}</strong>
                                      </span>
                                      <span>
                                        Saldo: <strong>{money(u.inPersonBalanceArs ?? 0)}</strong>
                                      </span>
                                    </div>
                                  )}
                                </div>
                              ))
                            ) : hasLegacyUsage ? (
                              <div className="kani-dcard-usage-row">
                                <div className="kani-dcard-usage-top">
                                  <div>
                                    <strong>{item.clientName || 'Cliente'}</strong>
                                    {item.clientPhone ? ` · ${item.clientPhone}` : ''}
                                    {item.clientEmail ? ` (${item.clientEmail})` : ''}
                                  </div>
                                  {item.appointmentRequestNumber && (
                                    <div className="kani-dcard-usage-meta">
                                      Turno #{item.appointmentRequestNumber}
                                      {item.appointmentDate ? ` · ${item.appointmentDate}` : ''}
                                      {item.appointmentTime ? ` ${item.appointmentTime}` : ''}
                                    </div>
                                  )}
                                </div>
                                {item.finalPriceArs !== null && item.finalPriceArs !== undefined && (
                                  <div className="kani-dcard-usage-amounts">
                                    <span>
                                      Original: <strong>{money(item.originalPriceArs ?? 0)}</strong>
                                    </span>
                                    <span>
                                      Total: <strong>{money(item.finalPriceArs)}</strong>
                                    </span>
                                    <span>
                                      Seña: <strong>{money(item.onlineDepositArs ?? 0)}</strong>
                                    </span>
                                    <span>
                                      Saldo: <strong>{money(item.inPersonBalanceArs ?? 0)}</strong>
                                    </span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p style={{ margin: 0, fontSize: '12px', color: 'var(--dc-muted)' }}>
                                Sin utilizaciones registradas.
                              </p>
                            )}
                            </div>
                          )}
                        </section>

                        {status !== 'DELETED' && (
                          <div className="kani-dcard-details-danger">
                            <button
                              type="button"
                              className="v2-secondary kani-dcard-details-delete-btn is-destructive"
                              onClick={() => openDeleteConfirm(item)}
                              title="Eliminar código (conserva historial)"
                            >
                              <Trash2 size={14} aria-hidden="true" />
                              <span>Eliminar código</span>
                            </button>
                          </div>
                        )}
                      </div>
                      );
                    })()}
                  </article>
                );
              })}
            </div>
            </>
          )}
        </>
      )}

      {/* ==============================================================================
          MODAL 1: GENERAR CÓDIGO (VIEWPORT-SAFE Y CAMPOS PROGRESIVOS)
         ============================================================================== */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          overlayClassName="benefit-code-dialog-overlay"
          className="benefit-code-dialog-content kani-modal-shell"
          transitionMode="container-transform"
          showCloseButton={false}
        >
          <div className="benefit-code-dialog-header kani-modal-header">
            <DialogTitle className="text-[1rem] sm:text-lg font-semibold leading-tight flex items-center gap-2">
              <Sparkles size={18} className="hidden sm:inline-block text-gold shrink-0" />
              <span>Generar código</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Formulario de creación de código de beneficio y descuento
            </DialogDescription>
            <KaniModalClose label="Cerrar" />
          </div>

          {createdItem ? (
            <div className="benefit-code-dialog-scroll-body kani-modal-body">
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
              <div className="benefit-code-dialog-scroll-body kani-modal-body">
                {/* 1. Modalidad de uso */}
                <div className="space-y-1.5 sm:space-y-2">
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
                          className={`flex flex-col justify-center p-2.5 rounded-lg border cursor-pointer transition-colors min-h-[44px] ${
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
                              className="accent-gold text-gold shrink-0"
                            />
                            <span className="text-xs sm:text-sm font-semibold text-foreground leading-tight">{def.label}</span>
                          </div>
                          <span className="hidden sm:block text-[11px] text-muted-foreground mt-1 leading-snug">
                            {def.description}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Tipo de beneficio */}
                <div className="space-y-1.5 sm:space-y-2">
                  <label className="text-xs font-semibold text-foreground block">
                    Beneficio:
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-1 gap-2">
                    {(['PERCENT_10', 'PERCENT_50', 'NO_DEPOSIT', 'FREE_SERVICE'] as const).map((t) => {
                      const d = BENEFIT_TYPE_DEFINITIONS[t];
                      const isSelected = selectedType === t;
                      const mobileCompactLabel =
                        t === 'PERCENT_10'
                          ? '10 % OFF'
                          : t === 'PERCENT_50'
                            ? '50 % OFF'
                            : t === 'NO_DEPOSIT'
                              ? 'Sin seña'
                              : 'Servicio gratis';
                      return (
                        <label
                          key={t}
                          className={`flex items-center sm:items-start gap-2 sm:gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors min-h-[46px] min-w-0 ${
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
                            className="sm:mt-1 accent-gold text-gold shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <span className="sm:hidden text-xs font-semibold text-foreground leading-tight block whitespace-nowrap">
                              {mobileCompactLabel}
                            </span>
                            <div className="hidden sm:flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-foreground">{d.label}</span>
                              <span className="text-[11px] font-semibold text-gold">{d.shortLabel}</span>
                            </div>
                            <p className="hidden sm:block text-[11px] text-muted-foreground mt-0.5 leading-snug">{d.description}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Vigencia */}
                <div className="space-y-2 pt-2 border-t border-border/50">
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor="create-validity-type" className="text-xs font-semibold text-foreground shrink-0">
                      Vigencia:
                    </label>
                    <span className="text-[11px] font-medium text-muted-foreground text-right whitespace-nowrap">
                      Buenos Aires (UTC-3)
                    </span>
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
                    <div className="p-2.5 sm:p-3 rounded-lg bg-muted/30 border border-border space-y-2.5 sm:space-y-3 mt-1.5">
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

                  {/* Aclaración visible en desktop; en mobile se accede vía ícono info */}
                  <div className="hidden sm:flex p-2 rounded bg-muted/40 border border-border/60 text-[11px] text-muted-foreground items-center gap-1.5">
                    <HelpCircle size={13} className="text-gold shrink-0" />
                    <span>
                      <strong>Nota de vigencia:</strong> La vigencia determina cuándo puede confirmarse la reserva con el código, no la fecha del turno.
                    </span>
                  </div>
                </div>

                {/* 4. Código personalizado (opcional) */}
                <div className="space-y-1">
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
                  <span className="hidden sm:block text-[11px] text-muted-foreground">
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

              <DialogFooter className="benefit-code-dialog-footer kani-modal-footer">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  disabled={creating}
                  className="v2-secondary min-h-[44px] text-xs"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={creating}
                  className="action-positive min-h-[44px] text-xs font-semibold"
                >
                  {creating ? <RefreshCw size={14} className="animate-spin mr-1.5" /> : <Sparkles size={14} className="mr-1.5" />}
                  <span>{creating ? 'Generando…' : 'Crear código'}</span>
                </Button>
              </DialogFooter>
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
          className="benefit-code-dialog-content kani-modal-shell kani-dvalidity-dialog sm:max-w-md"
          transitionMode="container-transform"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <div className="benefit-code-dialog-header kani-modal-header">
            <DialogTitle className="text-base font-semibold text-foreground">
              Editar vigencia
            </DialogTitle>
            <KaniModalClose label="Cerrar" />
          </div>

          <form onSubmit={handleEditValiditySubmit} className="benefit-code-dialog-form flex flex-col flex-1 min-h-0">
            <div className="benefit-code-dialog-scroll-body kani-modal-body">
              <div className="kani-dvalidity-field">
                <span className="text-xs font-medium text-foreground block">
                  Código de descuento
                </span>
                <div className="kani-dvalidity-code-box select-all" aria-label="Código de descuento">
                  {codeToEditValidity?.code}
                </div>
              </div>

              <div className="kani-dvalidity-field">
                <label htmlFor="edit-validity-type" className="text-xs font-medium text-foreground block">
                  Vigencia
                </label>
                <select
                  id="edit-validity-type"
                  value={editValidityType}
                  onChange={(e) => setEditValidityType(e.target.value as BenefitValidityType)}
                  className="h-10 w-full px-3 text-sm bg-background border border-input rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
                >
                  <option value="NO_EXPIRATION">Sin vencimiento</option>
                  <option value="ONE_WEEK">Durante una semana (7 días)</option>
                  <option value="ONE_MONTH">Durante un mes (mes calendario)</option>
                  <option value="CUSTOM_DURATION">Duración personalizada (X días, semanas o meses)</option>
                  <option value="DATE_RANGE">Desde una fecha hasta otra</option>
                </select>
                <p className="kani-dvalidity-note">
                  Los cambios no afectan las reservas confirmadas.
                </p>
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

            <DialogFooter className="benefit-code-dialog-footer kani-modal-footer kani-dvalidity-footer">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCodeToEditValidity(null)}
                disabled={editingValidity}
                className="v2-secondary min-h-[44px]"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={editingValidity}
                className="action-positive min-h-[44px]"
              >
                {editingValidity ? <RefreshCw size={14} className="animate-spin mr-1.5" /> : null}
                <span>{editingValidity ? 'Guardando…' : 'Guardar'}</span>
              </Button>
            </DialogFooter>
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
          className="benefit-code-dialog-content kani-modal-shell kani-dtoggle-dialog"
          transitionMode="container-transform"
          showCloseButton={false}
        >
          <div className="benefit-code-dialog-header kani-modal-header-row">
            <DialogTitle className="kani-modal-title">
              {codeToToggle?.targetActive ? 'Activar código' : 'Desactivar código'}
            </DialogTitle>
            <KaniModalClose
              label="Cerrar"
              onClick={() => !togglingStatus && setCodeToToggle(null)}
            />
          </div>

          <div className="benefit-code-dialog-scroll-body kani-dtoggle-body">
            {codeToToggle?.item.code && (
              <div className="kani-dvalidity-code-box" aria-label="Código seleccionado">
                <span className="kani-dvalidity-code-label">Código</span>
                <span className="kani-dvalidity-code-value">{codeToToggle.item.code}</span>
              </div>
            )}

            <DialogDescription className="kani-dtoggle-desc">
              {codeToToggle?.targetActive
                ? 'El código volverá a estar disponible para nuevas reservas según sus condiciones de vigencia.'
                : 'El código dejará de estar disponible para nuevas reservas. Las reservas confirmadas no se modificarán.'}
            </DialogDescription>

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
            <DialogFooter className="kani-dtoggle-footer">
              <Button
                variant="outline"
                onClick={() => setCodeToToggle(null)}
                disabled={togglingStatus}
                className="v2-secondary"
              >
                Cancelar
              </Button>
              {!(
                codeToToggle?.targetActive &&
                codeToToggle.item.validUntil &&
                new Date(codeToToggle.item.validUntil).getTime() < Date.now()
              ) && (
                <Button
                  onClick={handleToggleConfirm}
                  disabled={togglingStatus}
                  className={
                    codeToToggle?.targetActive ? 'action-positive' : 'v2-destructive'
                  }
                >
                  {togglingStatus
                    ? 'Procesando…'
                    : codeToToggle?.targetActive
                    ? 'Activar'
                    : 'Desactivar'}
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
          transitionMode="container-transform"
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
