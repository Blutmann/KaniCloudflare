import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Mail,
  Phone,
  Search,
  Scissors,
  User,
  Users,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatPhoneDisplay } from '@/lib/kani-phone';
import { dateLabel } from '@/lib/kani-model';
import {
  filterAndSortClients,
  type ClientDirectoryItem,
  type ClientSortField,
  type SortDirection,
} from '@/lib/kani-statistics';

interface AdminClientsProps {
  clients: ClientDirectoryItem[];
  loading?: boolean;
}

const PAGE_SIZE = 10;

export function AdminClients({ clients, loading = false }: AdminClientsProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<ClientSortField>('lastBookingDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);

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
      <div className="admin-clients-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 pb-3 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <Users className="text-gold" size={20} />
            <h2 className="text-lg font-semibold tracking-tight">Directorio de Clientes</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Historial consolidado de clientes que han reservado turnos en el estudio.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground self-start sm:self-auto">
          <span className="font-semibold text-foreground">{clients.length}</span> clientes registrados
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
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
                      className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
                    >
                      <span>Nombre</span>
                      {renderSortIcon('name')}
                    </button>
                  </th>
                  <th scope="col" className="py-3 px-4 font-semibold">
                    <button
                      type="button"
                      onClick={() => handleSort('phone')}
                      className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
                    >
                      <span>Teléfono</span>
                      {renderSortIcon('phone')}
                    </button>
                  </th>
                  <th scope="col" className="py-3 px-4 font-semibold">
                    <button
                      type="button"
                      onClick={() => handleSort('email')}
                      className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
                    >
                      <span>Email</span>
                      {renderSortIcon('email')}
                    </button>
                  </th>
                  <th scope="col" className="py-3 px-4 font-semibold text-center">
                    <button
                      type="button"
                      onClick={() => handleSort('totalAppointments')}
                      className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors mx-auto"
                    >
                      <span>Total turnos</span>
                      {renderSortIcon('totalAppointments')}
                    </button>
                  </th>
                  <th scope="col" className="py-3 px-4 font-semibold">
                    <button
                      type="button"
                      onClick={() => handleSort('lastBookingDate')}
                      className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
                    >
                      <span>Última reserva</span>
                      {renderSortIcon('lastBookingDate')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {paginatedClients.map((client) => (
                  <tr
                    key={client.id}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    <td className="py-3 px-4 font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gold/15 text-gold flex items-center justify-center font-bold text-xs shrink-0">
                          {client.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="truncate max-w-[14rem]" title={client.name}>
                          {client.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                      {client.phone ? (
                        <a
                          href={`tel:${client.phone}`}
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
                      <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full font-semibold text-xs bg-gold/10 text-gold border border-gold/20">
                        {client.totalAppointments}
                      </span>
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
                className="p-3.5 rounded-xl border border-border bg-surface shadow-xs space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-gold/15 text-gold flex items-center justify-center font-bold text-xs shrink-0">
                      {client.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-semibold text-sm text-foreground truncate" title={client.name}>
                        {client.name}
                      </h4>
                      <div className="text-xs text-muted-foreground">
                        {client.totalAppointments} {client.totalAppointments === 1 ? 'reserva' : 'reservas'}
                      </div>
                    </div>
                  </div>

                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-gold/10 text-gold border border-gold/20 shrink-0">
                    {client.totalAppointments} turnos
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-1 text-xs pt-1 border-t border-border/50">
                  {client.phone && (
                    <a
                      href={`tel:${client.phone}`}
                      className="text-muted-foreground hover:text-gold inline-flex items-center gap-1.5 py-0.5"
                    >
                      <Phone size={13} className="text-muted-foreground shrink-0" />
                      <span>{formatPhoneDisplay(client.phone)}</span>
                    </a>
                  )}
                  {client.email && (
                    <a
                      href={`mailto:${client.email}`}
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
    </section>
  );
}
