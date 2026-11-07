import { useState, type FormEvent, type MouseEvent } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { sortClients, type ClientOrder } from "./client-order";
import { clientHistory } from "@/lib/kani-v2";
import { ClientCardMobile } from "./client-card-mobile";
import { money, formatServiceName } from "@/lib/kani-model";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useV2, type V2Client } from "./data";
import { Empty, Metric, Status } from "./shared";
import { isStaffOperator } from "@/lib/kani-permissions";
import { useClientDialogViewport } from "./use-client-dialog-viewport";
import "./client-dialog.css";
import "./client-cards-mobile.css";

function clientDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

export function V2Clients() {
  const data = useV2();
  const staff = useAdminStaff();
  const isAdmin = isStaffOperator(staff.profile.role);
  const barberId = staff.profile.barber_id;
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<V2Client | "new" | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [order, setOrder] = useState<ClientOrder>("newest");
  const [notice, setNotice] = useState("");
  const [errorNotice, setErrorNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<V2Client | null>(null);
  const [deleting, setDeleting] = useState(false);

  const selected = data.clients.find((c) => c.id === selectedId);
  const summary = selected ? clientHistory(selected.id, data.appointments, data.payments) : null;
  const dialogViewport = useClientDialogViewport(Boolean(selected || editing || confirmDelete));
  const rows = sortClients(
    data.clients.filter(
      (c) =>
        !c.archived &&
        !(c as any).deleted_at &&
        `${c.name} ${c.phone} ${c.email || ""}`.toLowerCase().includes(search.toLowerCase()),
    ),
    order,
  );

  function canEditClient(client: V2Client): boolean {
    if (isAdmin) return true;
    if (!barberId) return false;
    // The server returns only durable related cards, including manually created clients.
    return data.clients.some((row) => row.id === client.id);
  }

  function openEditor(client?: V2Client, e?: MouseEvent) {
    if (e) e.stopPropagation();
    if (client && !canEditClient(client)) {
      setErrorNotice("Solo podés editar clientes vinculados a tus propios turnos.");
      return;
    }
    setEditing(client ?? "new");
    setName(client?.name ?? "");
    setPhone(client?.phone ?? "");
    setEmail(client?.email ?? "");
    setErrorNotice("");
  }

  function promptDelete(client: V2Client, e: MouseEvent) {
    e.stopPropagation();
    if (!isAdmin) {
      setErrorNotice("Solo los administradores pueden eliminar clientes.");
      return;
    }
    setConfirmDelete(client);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setErrorNotice("El nombre del cliente debe tener al menos 2 caracteres.");
      return;
    }
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length < 6) {
      setErrorNotice("El celular debe tener al menos 6 dígitos.");
      return;
    }

    setSaving(true);
    setErrorNotice("");

    try {
      const clientId = editing && editing !== "new" ? editing.id : null;
      const { error } = await supabase.rpc("save_client", {
        p_id: clientId,
        p_name: name.trim(),
        p_phone: phone.trim(),
        p_email: email.trim() || null,
      });

      if (error) throw error;

      setEditing(null);
      setNotice(clientId ? "Cliente actualizado en Supabase." : "Cliente guardado en Supabase.");
      await data.refresh();
    } catch (err) {
      console.error("[KANI clients] Error guardando cliente:", err);
      setErrorNotice(err instanceof Error ? err.message : "Error al guardar cliente en Supabase.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteClient() {
    if (!confirmDelete) return;
    setDeleting(true);
    setErrorNotice("");

    try {
      const clientId = confirmDelete.id;
      const { error: rpcError } = await supabase.rpc("delete_client", {
        p_client_id: clientId,
      });

      if (rpcError) throw rpcError;

      const deletedName = confirmDelete.name;
      setConfirmDelete(null);
      setSelectedId(null);
      setNotice(`Cliente ${deletedName} eliminado correctamente.`);
      await data.refresh();
    } catch (err) {
      console.error("[KANI clients] Error eliminando cliente:", err);
      setErrorNotice(err instanceof Error ? err.message : "Error al eliminar cliente.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="v2-page">
      {notice && (
        <p role="status" className="v2-success">
          {notice}
        </p>
      )}
      {errorNotice && (
        <p role="alert" className="v2-alert">
          {errorNotice}
        </p>
      )}

      {/* Shared toolbar: one desktop row; the mobile search and controls keep their two rows. */}
      <div className="v2-client-toolbar-container">
        <div className="v2-client-search-row">
          <label className="v2-field v2-client-search-field" htmlFor="v2-client-search">
            <span className="v2-field-label">Buscar cliente</span>
            <span className="v2-search">
              <Search size={18} aria-hidden="true" />
              <input
                id="v2-client-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nombre, celular o email"
              />
            </span>
          </label>
        </div>
        <div className="v2-client-controls-row">
          <label className="v2-field v2-client-order">
            <span className="v2-field-label">Ordenar por</span>
            <select value={order} onChange={(e) => setOrder(e.target.value as ClientOrder)}>
              <option value="newest">Más recientes</option>
              <option value="oldest">Más antiguos</option>
              <option value="name-asc">Nombre A–Z</option>
              <option value="name-desc">Nombre Z–A</option>
            </select>
          </label>
          <button className="v2-primary v2-client-add-btn" onClick={() => openEditor()}>
            <Plus size={17} />
            Nuevo cliente
          </button>
        </div>
      </div>

      <div className="v2-client-grid">
        {!rows.length && <Empty>No hay clientes para esta búsqueda.</Empty>}
        {rows.map((c) => {
          const history = clientHistory(c.id, data.appointments, data.payments);
          const editable = canEditClient(c);
          return (
            <div className="v2-client-card" key={c.id} onClick={() => setSelectedId(c.id)}>
              <div className="v2-client-identity">
                <span className="v2-avatar">{c.name[0]}</span>
                <div className="v2-client-main-info">
                  <h2 className="v2-client-name">{c.name}</h2>
                  <div className="v2-client-contact">
                    <span className="v2-client-phone">{c.phone || "Sin celular"}</span>
                    {c.email && (
                      <>
                        <span className="v2-client-dot">·</span>
                        <span className="v2-client-email v2-truncate" title={c.email}>
                          {c.email}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="v2-client-meta">
                <span className="v2-client-visits">
                  {history.visits}{" "}
                  {history.visits === 1 ? "visita verificada" : "visitas verificadas"}
                </span>
                <span className="v2-client-meta-sep">·</span>
                <span className="v2-client-tag">Ficha existente</span>
              </div>

              <div className="v2-client-actions" onClick={(e) => e.stopPropagation()}>
                {editable && (
                  <button
                    type="button"
                    className="v2-client-action-btn edit"
                    onClick={(e) => openEditor(c, e)}
                    title="Editar cliente"
                    aria-label="Editar cliente"
                  >
                    <Pencil size={15} />
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    className="v2-client-action-btn delete"
                    onClick={(e) => promptDelete(c, e)}
                    title="Eliminar cliente"
                    aria-label="Eliminar cliente"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              <div className="v2-client-cta" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="v2-secondary v2-client-details-btn"
                  onClick={() => setSelectedId(c.id)}
                >
                  Ver detalles
                </button>
              </div>
              <ClientCardMobile
                client={c}
                canEdit={editable}
                canDelete={isAdmin}
                onDetails={() => setSelectedId(c.id)}
                onEdit={(event) => openEditor(c, event)}
                onDelete={(event) => promptDelete(c, event)}
              />
            </div>
          );
        })}
      </div>

      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent
          className="v2-dialog v2-client-modal v2-client-dialog"
          style={dialogViewport}
          overlayClassName="v2-client-modal-overlay"
          closeLabel="Cerrar detalles del cliente"
        >
          <div className="v2-client-modal-header">
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>
              Cliente desde {selected ? clientDate(selected.created_at) : ""}
            </DialogDescription>
          </div>
          {selected && summary && (
            <>
              <div
                className="v2-client-modal-scroll"
                role="region"
                aria-label="Información del cliente"
                tabIndex={0}
              >
                <dl className="v2-client-contact-facts">
                  <div>
                    <dt>Teléfono</dt>
                    <dd>
                      {selected.phone ? (
                        <a href={`tel:${selected.phone.replace(/[^+\d]/g, "")}`}>
                          {selected.phone}
                        </a>
                      ) : (
                        "Sin celular"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Correo electrónico</dt>
                    <dd>
                      {selected.email ? (
                        <a href={`mailto:${selected.email}`}>{selected.email}</a>
                      ) : (
                        "Sin correo electrónico"
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="v2-metrics">
                  <Metric label="Visitas verificadas" value={summary.visits} />
                  <Metric
                    label="Valor de servicios registrados"
                    value={money(summary.recordedSpend)}
                  />
                  <Metric label="Cancelaciones" value={summary.cancellations} />
                  <Metric
                    label="Última visita"
                    value={summary.lastVisit ? clientDate(summary.lastVisit) : "Sin registro"}
                  />
                </div>
                <p className="v2-client-frequency">
                  {summary.frequency !== null
                    ? `Frecuencia: cada ${summary.frequency} días.`
                    : "Historial insuficiente"}
                </p>
                <h3 className="v2-client-history-heading">Historial</h3>
                {!summary.history.length && (
                  <p className="v2-client-history-empty">Sin atenciones registradas.</p>
                )}
                {summary.history
                  .slice()
                  .reverse()
                  .map((a) => (
                    <div className="v2-history-row" key={a.id}>
                      <div>
                        <h3>
                          {a.name ? `${a.name} · ` : ""}
                          {formatServiceName(a.serviceName)} · {a.barber}
                        </h3>
                        <p>
                          {a.date} · {a.time}
                        </p>
                        {a.benefitCode && (
                          <div
                            style={{
                              marginTop: "4px",
                              fontSize: "11px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "2px",
                            }}
                          >
                            <span
                              style={{
                                fontFamily: "monospace",
                                fontWeight: 600,
                                color: "var(--gold, #C9A24D)",
                              }}
                            >
                              Código: {a.benefitCode} ·{" "}
                              {a.benefitType === "NO_DEPOSIT"
                                ? "Reserva sin seña (Seña online dispensada)"
                                : a.benefitType === "FREE_SERVICE"
                                  ? "Servicio 100% bonificado ($0)"
                                  : a.benefitType === "PERCENT_10"
                                    ? `Descuento 10% (-$${(a.benefitDiscountAmountArs ?? 0).toLocaleString("es-AR")})`
                                    : a.benefitType === "PERCENT_50"
                                      ? `Descuento 50% (-$${(a.benefitDiscountAmountArs ?? 0).toLocaleString("es-AR")})`
                                      : "Beneficio aplicado"}
                            </span>
                            {a.statusCode === "CANCELLED" && (
                              <span
                                style={{
                                  color: "var(--muted-foreground, #888)",
                                  fontStyle: "italic",
                                }}
                              >
                                Reserva cancelada · código consumido, no reutilizable
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <Status code={a.statusCode} />
                    </div>
                  ))}
              </div>
              <footer className="v2-client-modal-footer">
                {canEditClient(selected) && (
                  <button
                    className="v2-secondary"
                    onClick={() => {
                      setSelectedId(null);
                      openEditor(selected);
                    }}
                  >
                    Editar cliente
                  </button>
                )}
                {isAdmin && (
                  <button className="v2-destructive" onClick={() => setConfirmDelete(selected)}>
                    Eliminar cliente
                  </button>
                )}
              </footer>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirmDelete}
        onOpenChange={(open) => {
          if (!open && !deleting) setConfirmDelete(null);
        }}
      >
        <DialogContent
          className="v2-dialog v2-client-modal v2-client-confirm"
          style={dialogViewport}
          overlayClassName="v2-client-modal-overlay v2-client-confirm-overlay"
        >
          <div className="v2-client-modal-header">
            <DialogTitle>¿Eliminar este cliente?</DialogTitle>
          </div>
          <div className="v2-client-modal-scroll">
            <DialogDescription>
              {confirmDelete?.name} dejará de figurar en la lista de clientes activos. Se preservará
              todo su historial de turnos y pagos pasados.
            </DialogDescription>
            {errorNotice && (
              <p role="alert" className="v2-alert">
                {errorNotice}
              </p>
            )}
          </div>
          <footer className="v2-client-modal-footer">
            <button
              className="v2-secondary"
              disabled={deleting}
              onClick={() => setConfirmDelete(null)}
            >
              Cancelar
            </button>
            <button
              className="v2-destructive"
              disabled={deleting}
              onClick={() => void handleDeleteClient()}
            >
              {deleting ? "Eliminando…" : "Sí, eliminar"}
            </button>
          </footer>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !saving) setEditing(null);
        }}
      >
        <DialogContent
          className="v2-dialog v2-client-modal v2-client-editor"
          style={dialogViewport}
          overlayClassName="v2-client-modal-overlay"
        >
          <div className="v2-client-modal-header">
            <DialogTitle>{editing === "new" ? "Nuevo cliente" : "Editar cliente"}</DialogTitle>
            <DialogDescription>
              Los datos se guardan de forma permanente en Supabase.
            </DialogDescription>
          </div>
          <form onSubmit={save} className="v2-client-editor-form">
            <div className="v2-client-modal-scroll">
              {errorNotice && (
                <p role="alert" className="v2-alert">
                  {errorNotice}
                </p>
              )}
              <label className="v2-field">
                Nombre
                <input
                  required
                  minLength={2}
                  disabled={saving}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="v2-field">
                Celular
                <input
                  required
                  type="tel"
                  minLength={6}
                  disabled={saving}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
              <label className="v2-field">
                Email · opcional
                <input
                  type="email"
                  disabled={saving}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            </div>
            <footer className="v2-client-modal-footer">
              <button className="v2-primary" disabled={saving}>
                {saving ? "Guardando…" : "Guardar cliente"}
              </button>
            </footer>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
