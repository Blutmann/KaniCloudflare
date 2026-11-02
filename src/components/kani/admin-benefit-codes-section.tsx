import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Ban,
  Check,
  Copy,
  Gift,
  Key,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  UserCheck,
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
import {
  BENEFIT_TYPE_DEFINITIONS,
  type BenefitCodeItem,
  type BenefitCodeStatus,
  type BenefitCodeType,
} from '@/lib/kani-benefit-codes';
import {
  adminCreateBenefitCodeFn,
  adminDisableBenefitCodeFn,
  adminListBenefitCodesFn,
} from '@/lib/kani-benefit-codes.functions';
import { money } from '@/lib/kani-model';

export function BenefitCodesAdminSection() {
  const [items, setItems] = useState<BenefitCodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | BenefitCodeStatus>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Create Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<BenefitCodeType>('PERCENT_10');
  const [internalNote, setInternalNote] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdItem, setCreatedItem] = useState<BenefitCodeItem | null>(null);

  // Disable Modal
  const [codeToDisable, setCodeToDisable] = useState<BenefitCodeItem | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [disableError, setDisableError] = useState('');

  // Copy indicator
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const loadCodes = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminListBenefitCodesFn();
      setItems(res || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar los códigos de beneficio.');
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
      // Fallback
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2500);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const newItem = await adminCreateBenefitCodeFn({
        data: {
          type: selectedType,
          internalNote: internalNote.trim() || undefined,
          code: customCode.trim() || undefined,
        },
      });
      setCreatedItem(newItem);
      setInternalNote('');
      setCustomCode('');
      await loadCodes();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'No se pudo generar el código.');
    } finally {
      setCreating(false);
    }
  };

  const handleDisableConfirm = async () => {
    if (!codeToDisable) return;
    setDisabling(true);
    setDisableError('');
    try {
      await adminDisableBenefitCodeFn({ data: { codeId: codeToDisable.id } });
      setCodeToDisable(null);
      await loadCodes();
    } catch (err) {
      setDisableError(err instanceof Error ? err.message : 'Error al desactivar el código.');
    } finally {
      setDisabling(false);
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        item.code.toLowerCase().includes(term) ||
        (item.internalNote && item.internalNote.toLowerCase().includes(term)) ||
        (item.clientName && item.clientName.toLowerCase().includes(term)) ||
        (item.clientEmail && item.clientEmail.toLowerCase().includes(term)) ||
        (item.clientPhone && item.clientPhone.includes(term))
      );
    });
  }, [items, statusFilter, searchTerm]);

  return (
    <section className="maintenance-section p-5 sm:p-6 rounded-[var(--radius-card)] border border-border bg-card space-y-5" aria-labelledby="discounts-title">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-border">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Tag size={20} className="text-gold shrink-0" />
            <h2 id="discounts-title" className="text-lg font-semibold tracking-tight text-foreground">
              Descuentos y Beneficios
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Gestión de códigos propios de un solo uso para reservas, señas y bonificaciones especiales.
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
            }}
            className="action-brand min-h-[38px] text-xs font-semibold"
          >
            <Plus size={16} className="shrink-0" />
            <span>Generar código</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-xs sm:text-sm flex items-center gap-2">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filtros y búsqueda */}
      <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center justify-between">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 text-xs">
          {(['ALL', 'ACTIVE', 'LOCKED', 'CONSUMED', 'DISABLED'] as const).map((st) => {
            const count = st === 'ALL' ? items.length : items.filter((i) => i.status === st).length;
            const labels: Record<string, string> = {
              ALL: 'Todos',
              ACTIVE: 'Disponibles',
              LOCKED: 'En checkout',
              CONSUMED: 'Consumidos',
              DISABLED: 'Desactivados',
            };
            const active = statusFilter === st;
            return (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-gold/15 border-gold text-gold font-semibold'
                    : 'bg-muted/40 border-border text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {labels[st]} ({count})
              </button>
            );
          })}
        </div>

        <div className="relative min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por código, cliente o nota…"
            className="pl-8 text-xs h-9 bg-background"
          />
        </div>
      </div>

      {/* Lista de Códigos */}
      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <RefreshCw size={24} className="animate-spin text-gold" />
          <span className="text-xs">Cargando códigos de beneficios…</span>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="py-12 text-center border border-dashed border-border rounded-lg p-6 bg-muted/20">
          <Gift size={32} className="mx-auto text-muted-foreground/60 mb-2" />
          <p className="text-sm font-medium text-foreground">No se encontraron códigos</p>
          <p className="text-xs text-muted-foreground mt-1">
            {searchTerm || statusFilter !== 'ALL'
              ? 'Probá ajustando los filtros de búsqueda.'
              : 'Generá el primer código de beneficio para una reserva.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const def = BENEFIT_TYPE_DEFINITIONS[item.type];
            const isConsumed = item.status === 'CONSUMED';
            const isLocked = item.status === 'LOCKED';
            const isActive = item.status === 'ACTIVE';
            const isDisabled = item.status === 'DISABLED';
            const isCopied = copiedCode === item.code;

            return (
              <div
                key={item.id}
                className="p-4 rounded-lg border border-border bg-background/50 hover:bg-background/80 transition-colors space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-base font-bold tracking-wider text-foreground select-all bg-muted/50 px-2.5 py-1 rounded border border-border/80">
                      {item.code}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleCopy(item.code)}
                      className="h-8 px-2.5 text-xs text-gold hover:text-gold/80"
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
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${
                      item.type === 'FREE_SERVICE'
                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                        : item.type === 'NO_DEPOSIT'
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                        : 'bg-gold/10 text-gold border-gold/30'
                    }`}>
                      {def.shortLabel}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Badge de estado */}
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                      isActive
                        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                        : isLocked
                        ? 'bg-amber-500/10 text-amber-500 border-amber-500/30 animate-pulse'
                        : isConsumed
                        ? 'bg-muted text-muted-foreground border-border'
                        : 'bg-destructive/10 text-destructive border-destructive/20'
                    }`}>
                      {isActive && <Check size={12} />}
                      {isLocked && <Lock size={12} />}
                      {isConsumed && <UserCheck size={12} />}
                      {isDisabled && <Ban size={12} />}
                      <span>
                        {isActive
                          ? 'Disponible'
                          : isLocked
                          ? 'Bloqueado en checkout'
                          : isConsumed
                          ? 'Consumido'
                          : 'Desactivado'}
                      </span>
                    </span>

                    {/* Botón de desactivar */}
                    {isActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCodeToDisable(item)}
                        className="h-8 text-xs text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                        title="Desactivar este código"
                      >
                        <XCircle size={14} className="mr-1" />
                        <span>Desactivar</span>
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs text-muted-foreground pt-1 border-t border-border/50">
                  <div>
                    <span className="block font-medium text-foreground">{def.label}</span>
                    <span className="text-[11px] text-muted-foreground">{def.description}</span>
                  </div>
                  <div>
                    <span className="block text-muted-foreground">Creado por:</span>
                    <span className="text-foreground font-medium">
                      {item.createdByDisplayName || 'Administrador'} · {new Date(item.createdAt).toLocaleDateString('es-AR')}
                    </span>
                  </div>
                  {item.internalNote && (
                    <div className="sm:col-span-2">
                      <span className="block text-muted-foreground">Nota interna:</span>
                      <span className="text-foreground italic">{item.internalNote}</span>
                    </div>
                  )}
                </div>

                {/* Trazabilidad de uso si fue consumido */}
                {isConsumed && (
                  <div className="mt-2 p-3 rounded-md bg-muted/40 border border-border text-xs space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <UserCheck size={14} className="text-gold shrink-0" />
                        <span className="font-semibold text-foreground">
                          Utilizado por: {item.clientName || 'Cliente'}
                        </span>
                        {item.clientPhone && <span>· {item.clientPhone}</span>}
                        {item.clientEmail && <span className="text-muted-foreground">({item.clientEmail})</span>}
                      </div>
                      {item.appointmentRequestNumber && (
                        <span className="text-muted-foreground font-mono">
                          Turno #{item.appointmentRequestNumber} ({item.appointmentDate} {item.appointmentTime})
                        </span>
                      )}
                    </div>

                    {/* Desglose de importes snapshot */}
                    {item.finalPriceArs !== null && item.finalPriceArs !== undefined && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground pt-1 border-t border-border/60">
                        <span>Original: <strong className="text-foreground">{money(item.originalPriceArs ?? 0)}</strong></span>
                        {item.type !== 'NO_DEPOSIT' && (
                          <span>Descuento: <strong className="text-gold">−{money(item.discountAmountArs ?? 0)}</strong></span>
                        )}
                        <span>Total final: <strong className="text-foreground">{money(item.finalPriceArs)}</strong></span>
                        <span>Seña abonada: <strong className="text-gold">{money(item.onlineDepositArs ?? 0)}</strong></span>
                        <span>Saldo en local: <strong className="text-foreground">{money(item.inPersonBalanceArs ?? 0)}</strong></span>
                      </div>
                    )}

                    {/* Aviso si la reserva fue cancelada */}
                    {item.isAppointmentCancelled && (
                      <div className="p-2 rounded bg-destructive/10 border border-destructive/20 text-destructive text-[11px] flex items-center gap-1.5 font-medium">
                        <AlertCircle size={13} className="shrink-0" />
                        <span>Reserva cancelada · código consumido, no reutilizable</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal para Generar Código */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-lg p-5 sm:p-6 rounded-[var(--radius-card)]">
          <DialogTitle className="text-lg font-semibold flex items-center gap-2">
            <Sparkles size={18} className="text-gold" />
            <span>Generar código de beneficio</span>
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
            Los códigos son de un solo uso y quedan vinculados estrictamente a la reserva y cliente que los utilice.
          </DialogDescription>

          {createdItem ? (
            <div className="my-4 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-center space-y-3">
              <p className="text-xs text-emerald-500 font-semibold uppercase tracking-wider">¡Código generado con éxito!</p>
              <p className="font-mono text-2xl font-bold tracking-wider text-foreground select-all bg-background py-2 px-3 rounded border border-emerald-500/40">
                {createdItem.code}
              </p>
              <p className="text-xs text-muted-foreground">
                Tipo: <strong className="text-foreground">{BENEFIT_TYPE_DEFINITIONS[createdItem.type].label}</strong>
              </p>
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
          ) : (
            <form onSubmit={handleCreate} className="space-y-4 my-2">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground block">
                  Seleccioná el tipo de beneficio:
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {(['NO_DEPOSIT', 'FREE_SERVICE', 'PERCENT_10', 'PERCENT_50'] as const).map((t) => {
                    const d = BENEFIT_TYPE_DEFINITIONS[t];
                    const isSelected = selectedType === t;
                    return (
                      <label
                        key={t}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-gold/10 border-gold shadow-sm'
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
                            <span className="text-xs sm:text-sm font-semibold text-foreground">{d.label}</span>
                            <span className="text-[11px] font-semibold text-gold">{d.shortLabel}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{d.description}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground block">
                  Nota interna (opcional):
                </label>
                <Input
                  value={internalNote}
                  onChange={(e) => setInternalNote(e.target.value)}
                  placeholder="Ej: Cortesía por demora, influencer, fidelización cliente…"
                  className="text-xs bg-background"
                  maxLength={250}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground block">
                  Código personalizado (opcional, dejar en blanco para aleatorio):
                </label>
                <Input
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                  placeholder="Ej: KANI-VIP-2026"
                  className="text-xs font-mono uppercase bg-background"
                  maxLength={32}
                />
                <span className="text-[11px] text-muted-foreground block">
                  Si no se especifica, se generará un código criptográfico único e irrepetible.
                </span>
              </div>

              {createError && (
                <div className="p-2.5 rounded bg-destructive/10 text-destructive text-xs flex items-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <DialogFooter className="mt-4 flex flex-col-reverse sm:flex-row gap-2">
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
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal para Desactivar Código */}
      <Dialog open={!!codeToDisable} onOpenChange={(open) => !disabling && !open && setCodeToDisable(null)}>
        <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-md p-5 sm:p-6 rounded-[var(--radius-card)]">
          <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <Ban size={18} className="text-destructive shrink-0" />
            <span>¿Desactivar código {codeToDisable?.code}?</span>
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground leading-relaxed mt-1.5">
            El código no podrá volver a ser utilizado por ningún cliente. Esta acción no afecta turnos que ya lo hayan utilizado previamente.
          </DialogDescription>

          {disableError && (
            <div className="p-2.5 rounded bg-destructive/10 text-destructive text-xs flex items-center gap-2 mt-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{disableError}</span>
            </div>
          )}

          <DialogFooter className="mt-4 flex flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setCodeToDisable(null)}
              disabled={disabling}
              className="v2-secondary min-h-[40px] text-xs"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleDisableConfirm}
              disabled={disabling}
              className="v2-destructive action-brand min-h-[40px] text-xs font-semibold"
            >
              {disabling ? <RefreshCw size={14} className="animate-spin mr-1.5" /> : <Ban size={14} className="mr-1.5" />}
              <span>{disabling ? 'Desactivando…' : 'Confirmar desactivación'}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
