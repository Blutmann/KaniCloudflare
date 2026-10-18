import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  History,
  Mail,
  Phone,
  Search,
  Scissors,
  User,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatPhoneDisplay } from '@/lib/kani-phone';
import { dateLabel } from '@/lib/kani-model';
import { updateRealAppointmentStatus } from '@/lib/kani-appointments';
import { extractErrorMessage } from '@/lib/kani-admin-activity';
import {
  filterAndSortClients,
  type ClientAppointmentHistoryItem,
  type ClientDirectoryItem,
  type ClientSortField,
  type SortDirection,
} from '@/lib/kani-statistics';

interface AdminClientsProps {
  clients: ClientDirectoryItem[];
  loading?: boolean;
  onAppointmentStatusChange?: (appointmentId: string, newStatus: 'CONFIRMED' | 'CANCELLED') => void;
}

const PAGE_SIZE = 10;

function formatDateTime(isoString?: string) {
  if (!isoString) return 'Fecha no registrada';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return isoString;
  }
}

function statusBadge(statusCode: string, label: string) {
  let badgeClass = 'bg-muted/40 text-muted-foreground border-border';
  if (statusCode === 'CONFIRMED' || statusCode === 'COMPLETED') {
    badgeClass = 'bg-success/15 text-success border-success/30';
  } else if (statusCode === 'PENDING') {
    badgeClass = 'bg-amber-500/15 text-amber-500 border-amber-500/30';
  } else if (statusCode === 'CANCELLED') {
    badgeClass = 'bg-destructive/15 text-destructive border-destructive/30';
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${badgeClass}`}
    >
      {(statusCode === 'CONFIRMED' || statusCode === 'COMPLETED') && <CheckCircle2 size={11} />}
      {statusCode === 'CANCELLED' && <XCircle size={11} />}
      {statusCode === 'PENDING' && <Clock size={11} />}
      {statusCode === 'COMPLETED' ? 'Confirmado' : label}
    </span>
  );
}

export function AdminClients({
  clients,
  loading = false,
  onAppointmentStatusChange,
}: AdminClientsProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<ClientSortField>('lastBookingDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedClient, setSelectedClient] = useState<ClientDirectoryItem | null>(null);

  // Estados para confirmación previa y persistencia de cambios de estado en turnos
  const [pendingAction, setPendingAction] = useState<{
    appointment: ClientAppointmentHistoryItem;
    nextStatus: 'CONFIRMED' | 'CANCELLED';
  } | null>(null);
  const [isSavingAction, setIsSavingAction] = useState(false);
  const [actionError, setActionError] = useState('');

  // 4 Métricas superiores del Directorio calculadas sobre la totalidad de turnos en alcance
  const metrics = useMemo(() => {
    let totales = 0;
    let confirmados = 0;
    let cancelados = 0;
    let pendientes = 0;

    for (const client of clients) {
      for (const apt of client.appointments) {
        totales++;
        const status = apt.statusCode;
        if (status === 'CONFIRMED' || (status as string) === 'COMPLETED') {
          confirmados++;
        } else if (status === 'CANCELLED') {
          cancelados++;
        } else if (status === 'PENDING' || (status as string) === 'REQUESTED') {
          pendientes++;
        }
      }
    }

    return { totales, confirmados, cancelados, pendientes };
  }, [clients]);

  async function handleConfirmAction() {
    if (!pendingAction || !selectedClient) return;
    const { appointment, nextStatus } = pendingAction;
    try {
      setIsSavingAction(true);
      setActionError('');
      await updateRealAppointmentStatus(appointment.id, nextStatus);

      // Actualizar visualmente el cliente seleccionado y sus contadores internos
      setSelectedClient((current) => {
        if (!current) return null;
        const updatedAppointments = current.appointments.map((a) =>
          a.id === appointment.id
            ? {
                ...a,
                statusCode: nextStatus,
                status: nextStatus === 'CONFIRMED' ? 'Confirmado' : 'Cancelado',
              }
            : a
        );
        return {
          ...current,
          totalConfirmed: updatedAppointments.filter(
            (a) => a.statusCode === 'CONFIRMED' || (a.statusCode as string) === 'COMPLETED'
          ).length,
          totalCancelled: updatedAppointments.filter((a) => a.statusCode === 'CANCELLED').length,
          totalActive: updatedAppointments.filter(
            (a) => a.statusCode === 'PENDING' || (a.statusCode as string) === 'REQUESTED'
          ).length,
          appointments: updatedAppointments,
        };
      });

      // Notificar al componente contenedor para sincronizar estadísticas globales
      onAppointmentStatusChange?.(appointment.id, nextStatus);

      setPendingAction(null);
    } catch (err) {
      setActionError(extractErrorMessage(err, 'No se pudo actualizar el turno.'));
    } finally {
      setIsSavingAction(false);
    }
  }

  function handleSort(field: ClientSortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'name' || field === 'email' ? 'asc' : 'desc');
    }
    setCurrentPage(1);
  }

  const filteredClients = useMemo(() => {
    return filterAndSortClients(clients, searchQuery, sortField, sortDirection);
  }, [clients, searchQuery, sortField, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedClients = useMemo(() => {
    const startIndex = (safePage - 1) * PAGE_SIZE;
    return filteredClients.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredClients, safePage]);

  function renderSortIcon(field: ClientSortField) {
    if (sortField !== field) {
      return <ArrowUpDown size={14} className="opacity-40" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp size={14} className="text-gold" />
    ) : (
      <ArrowDown size={14} className="text-gold" />
    );
  }

  return (
    <section className="admin-clients-section mt-10" aria-label="Directorio de clientes">
      {/* Encabezado limpio: únicamente Directorio de Clientes sin descripción */}
      <div className="admin-clients-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 pb-3 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <Users className="text-gold" size={20} />
            <h2 className="text-lg font-semibold tracking-tight">Directorio de Clientes</h2>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground self-start sm:self-auto">
          <span className="font-semibold text-foreground">{clients.length}</span> clientes registrados
        </div>
      </div>

      {/* 4 Métricas superiores del Directorio en una sola fila */}
      <div className="grid grid-cols-4 gap-1.5 sm:gap-3 mb-4">
        <div className="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-surface border border-border flex flex-col justify-between text-center min-w-0">
          <span className="text-[10px] sm:text-xs text-muted-foreground font-medium truncate">Totales</span>
          <span className="text-sm sm:text-lg md:text-xl font-bold text-foreground mt-0.5 sm:mt-1 truncate">
            {metrics.totales}
          </span>
        </div>
        <div className="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-success/10 border border-success/20 flex flex-col justify-between text-center min-w-0">
          <span className="text-[10px] sm:text-xs text-success font-medium truncate">Confirmados</span>
          <span className="text-sm sm:text-lg md:text-xl font-bold text-success mt-0.5 sm:mt-1 truncate">
            {metrics.confirmados}
          </span>
        </div>
        <div className="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-destructive/10 border border-destructive/20 flex flex-col justify-between text-center min-w-0">
          <span className="text-[10px] sm:text-xs text-destructive font-medium truncate">Cancelados</span>
          <span className="text-sm sm:text-lg md:text-xl font-bold text-destructive mt-0.5 sm:mt-1 truncate">
            {metrics.cancelados}
          </span>
        </div>
        <div className="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-amber-500/10 border border-amber-500/20 flex flex-col justify-between text-center min-w-0">
          <span className="text-[10px] sm:text-xs text-amber-500 font-medium truncate">Pendientes</span>
          <span className="text-sm sm:text-lg md:text-xl font-bold text-amber-500 mt-0.5 sm:mt-1 truncate">
            {metrics.pendientes}
          </span>
        </div>
      </div>

      {/* Real-time search and controls */}
      <div className="admin-clients-search-bar flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            type="search"
            placeholder="Buscar por nombre, email o teléfono..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="pl-9 pr-9 h-10 w-full text-sm bg-surface border-border"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label="Limpiar búsqueda"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Mobile sort selector */}
        <div className="flex items-center gap-2 sm:hidden">
          <span className="text-xs text-muted-foreground">Ordenar:</span>
          <select
            className="select-control flex-1 text-xs py-1.5 px-2 bg-surface border-border rounded-md"
            value={`${sortField}-${sortDirection}`}
            onChange={(e) => {
              const [field, dir] = e.target.value.split('-') as [ClientSortField, SortDirection];
              setSortField(field);
              setSortDirection(dir);
              setCurrentPage(1);
            }}
          >
            <option value="lastBookingDate-desc">Última reserva (más reciente)</option>
            <option value="lastBookingDate-asc">Última reserva (más antigua)</option>
            <option value="totalAppointments-desc">Total turnos (mayor a menor)</option>
            <option value="totalAppointments-asc">Total turnos (menor a mayor)</option>
            <option value="name-asc">Nombre (A-Z)</option>
            <option value="name-desc">Nombre (Z-A)</option>
            <option value="email-asc">Email (A-Z)</option>
            <option value="phone-asc">Teléfono (0-9)</option>
          </select>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="py-12 text-center text-muted-foreground">
          <div className="inline-block animate-spin mb-2">
            <Clock size={24} />
          </div>
          <p className="text-sm">Cargando directorio de clientes…</p>
        </div>
      )}

      {/* Empty search results */}
      {!loading && filteredClients.length === 0 && (
        <div className="py-10 px-4 text-center border border-dashed border-border rounded-xl bg-surface/50 my-4">
          <Users size={32} className="mx-auto text-muted-foreground/60 mb-2" />
          <h3 className="text-sm font-semibold text-foreground">No se encontraron clientes</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {searchQuery
              ? `No hay coincidencias para «${searchQuery}». Probá buscando con otro término.`
              : 'Todavía no hay clientes con reservas registradas en el sistema.'}
          </p>
          {searchQuery && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchQuery('')}
              className="mt-3 text-xs"
            >
              Borrar filtro
            </Button>
          )}
        </div>
      )}

      {/* Desktop / Tablet Table View */}
      {!loading && filteredClients.length > 0 && (
        <>
          <div className="hidden md:block overflow-x-auto rounded-xl border border-border bg-surface shadow-xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground select-none">
                  <th scope="col" className="py-3 px-4 font-semibold">
                    <button
                      type="button"
                      onClick={() => handleSort('name')}
                      className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
                    >
                      <span>Nombre</span>
                      {renderSortIcon('name')}
                    </button>
                  </th>
                  <th scope="col" className="py-3 px-4 font-semibold">
                    <button
                      type="button"
                      onClick={() => handleSort('phone')}
                      className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
                    >
                      <span>Teléfono</span>
                      {renderSortIcon('phone')}
                    </button>
                  </th>
                  <th scope="col" className="py-3 px-4 font-semibold">
                    <button
                      type="button"
                      onClick={() => handleSort('email')}
                      className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
                    >
                      <span>Email</span>
                      {renderSortIcon('email')}
                    </button>
                  </th>
                  <th scope="col" className="py-3 px-4 font-semibold text-center">
                    <button
                      type="button"
                      onClick={() => handleSort('totalAppointments')}
                      className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors mx-auto cursor-pointer"
                    >
                      <span>Total turnos</span>
                      {renderSortIcon('totalAppointments')}
                    </button>
                  </th>
                  <th scope="col" className="py-3 px-4 font-semibold">
                    <button
                      type="button"
                      onClick={() => handleSort('lastBookingDate')}
                      className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
                    >
                      <span>Última reserva</span>
                      {renderSortIcon('lastBookingDate')}
                    </button>
                  </th>
                  <th scope="col" className="py-3 px-4 font-semibold text-right">
                    <span>Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {paginatedClients.map((client) => (
                  <tr
                    key={client.id}
                    className="hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => setSelectedClient(client)}
                  >
                    <td className="py-3 px-4 font-medium text-foreground">
                      <span className="truncate max-w-[16rem] block font-semibold text-foreground" title={client.name}>
                        {client.name}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                      {client.phone ? (
                        <a
                          href={`tel:${client.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-gold transition-colors inline-flex items-center gap-1"
                        >
                          <Phone size={12} className="opacity-70" />
                          <span>{formatPhoneDisplay(client.phone)}</span>
                        </a>
                      ) : (
                        <span className="opacity-50">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {client.email ? (
                        <a
                          href={`mailto:${client.email}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-gold transition-colors inline-flex items-center gap-1 truncate max-w-[14rem]"
                          title={client.email}
                        >
                          <Mail size={12} className="opacity-70 shrink-0" />
                          <span className="truncate">{client.email}</span>
                        </a>
                      ) : (
                        <span className="opacity-50">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="inline-flex items-center gap-1">
                        <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full font-semibold text-xs bg-gold/10 text-gold border border-gold/20">
                          {client.totalAppointments}
                        </span>
                        {client.totalCancelled > 0 && (
                          <span
                            className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-destructive/10 text-destructive border border-destructive/20"
                            title={`${client.totalCancelled} turnos cancelados`}
                          >
                            {client.totalCancelled} canc.
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {client.lastBookingDate ? dateLabel(client.lastBookingDate) : '—'}
                        </span>
                        {client.lastBookingTime && (
                          <span className="text-[11px] text-muted-foreground">
                            {client.lastBookingTime}
                            {client.lastServiceName ? ` · ${client.lastServiceName}` : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedClient(client);
                        }}
                        className="h-7 px-2 text-xs gap-1 hover:text-gold"
                      >
                        <History size={13} />
                        <span>Historial</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card List View */}
          <div className="md:hidden space-y-2.5">
            {paginatedClients.map((client) => (
              <div
                key={client.id}
                className="p-3.5 rounded-xl border border-border bg-surface shadow-xs space-y-2.5 cursor-pointer hover:border-gold/50 transition-colors"
                onClick={() => setSelectedClient(client)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="font-semibold text-sm text-foreground truncate" title={client.name}>
                      {client.name}
                    </h4>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {client.totalAppointments} {client.totalAppointments === 1 ? 'reserva' : 'reservas'}
                      {client.totalCancelled > 0 && ` (${client.totalCancelled} canceladas)`}
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedClient(client);
                    }}
                    className="h-7 px-2 text-xs gap-1 text-gold border-gold/30 hover:bg-gold/10 shrink-0"
                  >
                    <History size={12} />
                    <span>Historial</span>
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-1 text-xs pt-1 border-t border-border/50">
                  {client.phone && (
                    <a
                      href={`tel:${client.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted-foreground hover:text-gold inline-flex items-center gap-1.5 py-0.5"
                    >
                      <Phone size={13} className="text-muted-foreground shrink-0" />
                      <span>{formatPhoneDisplay(client.phone)}</span>
                    </a>
                  )}
                  {client.email && (
                    <a
                      href={`mailto:${client.email}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted-foreground hover:text-gold inline-flex items-center gap-1.5 py-0.5 truncate"
                    >
                      <Mail size={13} className="text-muted-foreground shrink-0" />
                      <span className="truncate">{client.email}</span>
                    </a>
                  )}
                  <div className="text-muted-foreground inline-flex items-center gap-1.5 py-0.5">
                    <Calendar size={13} className="text-muted-foreground shrink-0" />
                    <span>
                      Último turno: {client.lastBookingDate ? dateLabel(client.lastBookingDate) : '—'}
                      {client.lastBookingTime ? ` a las ${client.lastBookingTime}` : ''}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination controls */}
          <div className="admin-clients-pagination flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-3 border-t border-border/60 text-xs text-muted-foreground">
            <div>
              Mostrando{' '}
              <span className="font-medium text-foreground">
                {(safePage - 1) * PAGE_SIZE + 1}-
                {Math.min(safePage * PAGE_SIZE, filteredClients.length)}
              </span>{' '}
              de <span className="font-medium text-foreground">{filteredClients.length}</span> clientes
              {searchQuery && ' filtrados'}
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="h-8 px-2.5 text-xs"
              >
                <ChevronLeft size={14} className="mr-0.5" />
                Anterior
              </Button>
              <span className="px-2 font-medium text-foreground">
                {safePage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="h-8 px-2.5 text-xs"
              >
                Siguiente
                <ChevronRight size={14} className="ml-0.5" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Client Full History Dialog */}
      <Dialog open={selectedClient !== null} onOpenChange={(open) => !open && setSelectedClient(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden bg-surface border-border">
          {selectedClient && (
            <>
              <DialogHeader className="p-5 pb-3 border-b border-border bg-muted/20 text-left sm:text-left">
                <div className="flex items-start justify-between gap-3 text-left">
                  <div className="min-w-0 text-left">
                    <DialogTitle className="text-lg font-bold text-foreground text-left">
                      {selectedClient.name}
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-left">
                      {selectedClient.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone size={12} />
                          {formatPhoneDisplay(selectedClient.phone)}
                        </span>
                      )}
                      {selectedClient.email && (
                        <span className="inline-flex items-center gap-1">
                          <Mail size={12} />
                          {selectedClient.email}
                        </span>
                      )}
                    </DialogDescription>
                  </div>
                </div>

                {/* Métricas del cliente en el Historial */}
                <div className="grid grid-cols-4 gap-1.5 sm:gap-2 mt-4 pt-3 border-t border-border/60 text-center">
                  <div className="p-1.5 sm:p-2 rounded-lg bg-background border border-border min-w-0">
                    <div className="text-[10px] sm:text-[11px] text-muted-foreground font-medium truncate">Totales</div>
                    <div className="text-sm sm:text-base font-bold text-foreground mt-0.5 truncate">
                      {selectedClient.totalAppointments}
                    </div>
                  </div>
                  <div className="p-1.5 sm:p-2 rounded-lg bg-success/10 border border-success/20 min-w-0">
                    <div className="text-[10px] sm:text-[11px] text-success font-medium truncate">Confirmados</div>
                    <div className="text-sm sm:text-base font-bold text-success mt-0.5 truncate">
                      {selectedClient.totalConfirmed ?? selectedClient.totalCompleted}
                    </div>
                  </div>
                  <div className="p-1.5 sm:p-2 rounded-lg bg-destructive/10 border border-destructive/20 min-w-0">
                    <div className="text-[10px] sm:text-[11px] text-destructive font-medium truncate">Cancelados</div>
                    <div className="text-sm sm:text-base font-bold text-destructive mt-0.5 truncate">
                      {selectedClient.totalCancelled}
                    </div>
                  </div>
                  <div className="p-1.5 sm:p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 min-w-0">
                    <div className="text-[10px] sm:text-[11px] text-amber-500 font-medium truncate">Pendientes</div>
                    <div className="text-sm sm:text-base font-bold text-amber-500 mt-0.5 truncate">
                      {selectedClient.appointments.filter((a) => a.statusCode === 'PENDING' || (a.statusCode as string) === 'REQUESTED').length}
                    </div>
                  </div>
                </div>
              </DialogHeader>

              {/* History list content */}
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <History size={14} className="text-gold" />
                    <span>Historial de turnos ({selectedClient.appointments.length})</span>
                  </h4>
                </div>

                {selectedClient.appointments.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground border border-dashed border-border rounded-lg">
                    No se encontraron registros de turnos para este cliente.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {selectedClient.appointments.map((apt) => (
                      <div
                        key={apt.id}
                        className={`p-3.5 rounded-xl border transition-colors ${
                          apt.statusCode === 'CANCELLED'
                            ? 'bg-destructive/5 border-destructive/20 opacity-80'
                            : 'bg-background border-border shadow-xs'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-2 border-b border-border/50">
                          <div className="flex items-center gap-2">
                            <Calendar size={14} className="text-gold shrink-0" />
                            <strong className="text-sm font-semibold text-foreground">
                              {dateLabel(apt.bookingDate)}
                            </strong>
                            <span className="text-xs text-muted-foreground">
                              a las {apt.startTime}
                              {apt.endTime ? ` hasta ${apt.endTime}` : ''}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 self-start sm:self-auto">
                            <div>{statusBadge(apt.statusCode, apt.status)}</div>
                            {/* Acciones de gestión directa desde el Historial */}
                            {apt.statusCode === 'PENDING' && (
                              <div className="flex items-center gap-1 ml-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActionError('');
                                    setPendingAction({ appointment: apt, nextStatus: 'CONFIRMED' });
                                  }}
                                  className="h-6 w-6 rounded-md flex items-center justify-center text-success border border-success/30 hover:bg-success/15 hover:border-success/50 transition-colors"
                                  title="Confirmar turno"
                                  aria-label={`Confirmar turno de ${selectedClient.name} para ${dateLabel(apt.bookingDate)} a las ${apt.startTime}`}
                                >
                                  <Check size={13} strokeWidth={2.5} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActionError('');
                                    setPendingAction({ appointment: apt, nextStatus: 'CANCELLED' });
                                  }}
                                  className="h-6 w-6 rounded-md flex items-center justify-center text-destructive border border-destructive/30 hover:bg-destructive/15 hover:border-destructive/50 transition-colors"
                                  title="Cancelar turno"
                                  aria-label={`Cancelar turno de ${selectedClient.name} para ${dateLabel(apt.bookingDate)} a las ${apt.startTime}`}
                                >
                                  <X size={13} strokeWidth={2.5} />
                                </button>
                              </div>
                            )}
                            {apt.statusCode === 'CONFIRMED' && (
                              <div className="flex items-center gap-1 ml-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActionError('');
                                    setPendingAction({ appointment: apt, nextStatus: 'CANCELLED' });
                                  }}
                                  className="h-6 w-6 rounded-md flex items-center justify-center text-destructive border border-destructive/30 hover:bg-destructive/15 hover:border-destructive/50 transition-colors"
                                  title="Cancelar turno"
                                  aria-label={`Cancelar turno de ${selectedClient.name} para ${dateLabel(apt.bookingDate)} a las ${apt.startTime}`}
                                >
                                  <X size={13} strokeWidth={2.5} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 text-xs">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Scissors size={13} className="shrink-0 text-muted-foreground/80" />
                            <span>Servicio:</span>
                            <span className="font-medium text-foreground">{apt.serviceName}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <User size={13} className="shrink-0 text-muted-foreground/80" />
                            <span>Barbero:</span>
                            <span className="font-medium text-foreground">{apt.barberName}</span>
                          </div>
                          {apt.createdAt && (
                            <div className="flex items-center gap-1.5 text-muted-foreground sm:col-span-2 text-[11px]">
                              <Clock size={12} className="shrink-0 text-muted-foreground/70" />
                              <span>Reserva creada el:</span>
                              <span className="font-medium text-foreground">
                                {formatDateTime(apt.createdAt)}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-1.5 text-muted-foreground sm:col-span-2 text-[11px]">
                            <span className="font-medium">Origen:</span>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              apt.isManual || apt.origin === 'MANUAL'
                                ? 'bg-gold/15 text-gold border border-gold/30'
                                : 'bg-muted text-muted-foreground'
                            }`}>
                              {apt.isManual || apt.origin === 'MANUAL' ? 'Turno manual' : 'Reserva pública'}
                            </span>
                            {(apt.isManual || apt.origin === 'MANUAL') && apt.createdByDisplayName && (
                              <span className="ml-1 text-muted-foreground">
                                · Generado por: <strong className="text-foreground">{apt.createdByDisplayName}</strong>
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-muted-foreground sm:col-span-2 text-[11px]">
                            <span className="font-medium">Abona seña:</span>
                            <strong className="text-foreground font-medium">
                              {apt.depositPaid || apt.depositRequired ? 'Sí' : 'No'}
                            </strong>
                          </div>
                          {apt.notes && (
                            <div className="sm:col-span-2 mt-1 p-2 rounded bg-muted/30 text-[11px] text-muted-foreground border border-border/40">
                              <span className="font-semibold text-foreground">Nota:</span> {apt.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Diálogo de confirmación previa antes de persistir cambio de estado */}
      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open && !isSavingAction) {
            setPendingAction(null);
            setActionError('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md bg-surface border-border">
          <DialogHeader className="text-left sm:text-left">
            <DialogTitle className="text-base font-bold text-foreground">
              {pendingAction?.nextStatus === 'CONFIRMED' ? '¿Confirmar turno?' : '¿Cancelar turno?'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground pt-2">
              {pendingAction?.nextStatus === 'CONFIRMED' ? (
                <span>
                  ¿Estás seguro de que deseás confirmar el turno de{' '}
                  <strong className="text-foreground">{selectedClient?.name}</strong> para el{' '}
                  <strong className="text-foreground">{dateLabel(pendingAction.appointment.bookingDate)}</strong> a las{' '}
                  <strong className="text-foreground">{pendingAction.appointment.startTime}</strong> con{' '}
                  <strong className="text-foreground">{pendingAction.appointment.barberName}</strong>?
                </span>
              ) : (
                <span>
                  ¿Estás seguro de que deseás cancelar el turno de{' '}
                  <strong className="text-foreground">{selectedClient?.name}</strong> para el{' '}
                  <strong className="text-foreground">{pendingAction ? dateLabel(pendingAction.appointment.bookingDate) : ''}</strong> a las{' '}
                  <strong className="text-foreground">{pendingAction?.appointment.startTime}</strong>? El turno quedará registrado como cancelado en el historial.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {actionError && (
            <div role="alert" className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
              {actionError}
            </div>
          )}

          <DialogFooter className="flex flex-row justify-end gap-2 mt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSavingAction}
              onClick={() => {
                setPendingAction(null);
                setActionError('');
              }}
            >
              Cancelar acción
            </Button>
            <Button
              type="button"
              variant={pendingAction?.nextStatus === 'CANCELLED' ? 'destructive' : 'default'}
              size="sm"
              disabled={isSavingAction}
              onClick={() => void handleConfirmAction()}
              className={pendingAction?.nextStatus === 'CONFIRMED' ? 'bg-success hover:bg-success/90 text-white font-medium' : ''}
            >
              {isSavingAction
                ? 'Guardando...'
                : pendingAction?.nextStatus === 'CONFIRMED'
                  ? 'Confirmar turno'
                  : 'Cancelar turno'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
