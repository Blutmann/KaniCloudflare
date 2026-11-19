import { useState, type FormEvent, type MouseEvent } from "react";
import { FileSpreadsheet, Loader2, Mail, Pencil, Phone, Plus, Search, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { sortClients, type ClientOrder } from "./client-order";
import { clientHistory } from "@/lib/kani-v2";
import { ClientCardMobile } from "./client-card-mobile";
import { money, formatServiceName } from "@/lib/kani-model";
import { businessDateToday } from "@/lib/kani-mobile-appointments";
import { staffExportClientsFn } from "@/lib/kani-clients-export.functions";
import { downloadClientsXlsx } from "@/lib/kani-clients-xlsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle, KaniModalClose } from "@/components/ui/dialog";
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
  const [exporting, setExporting] = useState(false);
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

  async function handleExportExcel() {
    if (exporting) return;
    setExporting(true);
    setErrorNotice("");
    setNotice("");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      const exportRows = await staffExportClientsFn({ data: { token } });
      const filename = await downloadClientsXlsx(exportRows, businessDateToday());
      setNotice(
        exportRows.length === 0
          ? `Se descargó ${filename} (sin clientes registrados).`
          : `Exportación completada: ${filename} (${exportRows.length} ${exportRows.length === 1 ? "cliente" : "clientes"}).`,
      );
    } catch (err) {
      console.error("[KANI clients] Error exportando clientes a Excel:", err);
      setErrorNotice(
        err instanceof Error
          ? err.message
          : "No pudimos exportar los clientes a Excel. Intentá nuevamente.",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="v2-page v2-clients-page">
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
          <button
            type="button"
            className="v2-primary v2-client-add-btn v2-client-add-btn--desktop"
            onClick={() => openEditor()}
          >
            <Plus size={17} aria-hidden="true" />
            <span>Nuevo cliente</span>
          </button>
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
          <button
            type="button"
            className="v2-secondary v2-client-export-btn"
            onClick={() => void handleExportExcel()}
            disabled={exporting}
            aria-busy={exporting}
            aria-label="Exportar clientes a Excel"
            title="Exportar clientes a Excel"
          >
            {exporting ? (
              <Loader2 size={17} className="animate-spin" aria-hidden="true" />
            ) : (
              <FileSpreadsheet size={17} aria-hidden="true" />
            )}
            <span>{exporting ? "Exportando…" : "Excel"}</span>
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
                    className="v2-client-action-btn delete v2-destructive"
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
          className="v2-dialog v2-client-modal v2-client-dialog kani-modal-shell"
          transitionMode="container-transform"
          style={dialogViewport}
          overlayClassName="v2-client-modal-overlay"
          showCloseButton={false}
          closeLabel="Cerrar detalles del cliente"
        >
          <div className="v2-client-modal-header kani-modal-header">
            <div className="kani-modal-header-text">
              <DialogTitle>{selected?.name}</DialogTitle>
              <DialogDescription>
                {selected ? `Cliente desde ${clientDate(selected.created_at)}` : ""}
                {summary && summary.frequency !== null
                  ? ` · Frecuencia: ${summary.frequency} días`
                  : ""}
              </DialogDescription>
            </div>
            <KaniModalClose label="Cerrar detalles del cliente" />
          </div>
          {selected && summary && (
            <>
              <div
                className="v2-client-modal-scroll kani-modal-body"
                role="region"
                aria-label="Información del cliente"
                tabIndex={0}
              >
                <div className="v2-client-contact-card" role="group" aria-label="Datos de contacto">
                  {selected.phone ? (
                    <a
                      className="v2-client-contact-row is-action"
                      href={`tel:${selected.phone.replace(/[^+\d]/g, "")}`}
                    >
                      <span className="v2-client-contact-copy">
                        <span className="v2-client-contact-label">Celular</span>
                        <span className="v2-client-contact-value">{selected.phone}</span>
                      </span>
                      <Phone className="v2-client-contact-icon" aria-hidden="true" />
                    </a>
                  ) : (
                    <div className="v2-client-contact-row is-empty">
                      <span className="v2-client-contact-copy">
                        <span className="v2-client-contact-label">Celular</span>
                        <span className="v2-client-contact-empty">Sin celular</span>
                      </span>
                    </div>
                  )}

                  {selected.email ? (
                    <a
                      className="v2-client-contact-row is-action"
                      href={`mailto:${selected.email}`}
                    >
                      <span className="v2-client-contact-copy">
                        <span className="v2-client-contact-label">Email</span>
                        <span className="v2-client-contact-value">{selected.email}</span>
                      </span>
                      <Mail className="v2-client-contact-icon" aria-hidden="true" />
                    </a>
                  ) : (
                    <div className="v2-client-contact-row is-empty">
                      <span className="v2-client-contact-copy">
                        <span className="v2-client-contact-label">Email</span>
                        <span className="v2-client-contact-empty">Sin email</span>
                      </span>
                    </div>
                  )}
                </div>

                <section className="v2-client-summary-surface" aria-label="Resumen operativo">
                  <div className="v2-client-summary-primary">
                    <div className="v2-client-kpi">
                      <span className="v2-client-kpi-label">Visitas</span>
                      <strong className="v2-client-kpi-value">{summary.visits}</strong>
                    </div>
                    <div className="v2-client-kpi">
                      <span className="v2-client-kpi-label">Última visita</span>
                      {summary.lastVisit ? (
                        <strong className="v2-client-kpi-value is-date">
                          {clientDate(summary.lastVisit)}
                        </strong>
                      ) : (
                        <span className="v2-client-kpi-empty">Sin registro</span>
                      )}
                    </div>
                  </div>
                  <div className="v2-client-summary-secondary">
                    <div className="v2-client-kpi">
                      <span className="v2-client-kpi-label">Total en servicios</span>
                      <strong className="v2-client-kpi-secondary">
                        {money(summary.recordedSpend)}
                      </strong>
                    </div>
                    <div className="v2-client-kpi is-end">
                      <span className="v2-client-kpi-label">Cancelaciones</span>
                      <strong className="v2-client-kpi-secondary">{summary.cancellations}</strong>
                    </div>
                  </div>
                </section>

                <h3 className="v2-client-history-heading">Membresías</h3>
                {!(data.memberships ?? []).filter((m) => m.clientId === selected.id).length ? (
                  <p className="v2-client-history-empty">Sin membresías registradas.</p>
                ) : (
                  <div className="v2-client-list-card">
                    {(data.memberships ?? [])
                      .filter((m) => m.clientId === selected.id)
                      .map((m) => (
                        <div className="v2-history-row" key={m.id}>
                          <div>
                            <h4>
                              {m.planName} ·{" "}
                              {m.status === "ACTIVE"
                                ? "Activa"
                                : m.status === "PENDING_PAYMENT"
                                  ? "Pendiente de pago"
                                  : m.status === "EXHAUSTED"
                                    ? "Agotada"
                                    : m.status === "EXPIRED"
                                      ? "Vencida"
                                      : "Cancelada"}
                            </h4>
                            <p>
                              {m.remainingSessions} de {m.totalSessions} sesiones ·{" "}
                              {m.expiresAt ? `Vence ${clientDate(m.expiresAt)}` : "Sin vencimiento"}
                            </p>
                            {m.items.length > 0 && (
                              <p className="v2-client-membership-items">
                                {m.items
                                  .map(
                                    (i) =>
                                      `${i.serviceName}: ${i.remainingQuantity}/${i.totalQuantity}`,
                                  )
                                  .join(" · ")}
                              </p>
                            )}
                          </div>
                          <strong className="v2-client-membership-price">
                            {money(m.totalPriceArs)}
                          </strong>
                        </div>
                      ))}
                  </div>
                )}

                <h3 className="v2-client-history-heading">Historial</h3>
                {!summary.history.length ? (
                  <p className="v2-client-history-empty">Sin atenciones registradas.</p>
                ) : (
                  <div className="v2-client-list-card">
                    {summary.history
                      .slice()
                      .reverse()
                      .map((a) => (
                        <div className="v2-history-row" key={a.id}>
                          <div>
                            <h4>
                              {formatServiceName(a.serviceName)} · {a.barber}
                            </h4>
                            <p>
                              {clientDate(a.date)} · {a.time} hs
                            </p>
                            {a.benefitCode && (
                              <div className="v2-client-benefit-meta">
                                <span className="v2-client-benefit-code">
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
                                  <span className="v2-client-benefit-cancelled">
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
                )}
              </div>
              <footer className="v2-client-modal-footer kani-modal-footer">
                {canEditClient(selected) && (
                  <button
                    className="v2-secondary"
                    aria-label="Editar cliente"
                    onClick={() => {
                      setSelectedId(null);
                      openEditor(selected);
                    }}
                  >
                    Editar
                  </button>
                )}
                {isAdmin && (
                  <button
                    className="v2-destructive"
                    aria-label="Eliminar cliente"
                    onClick={() => setConfirmDelete(selected)}
                  >
                    Eliminar
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
          transitionMode="container-transform"
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
          className="v2-dialog v2-client-modal v2-client-editor kani-modal-shell"
          transitionMode="container-transform"
          style={dialogViewport}
          overlayClassName="v2-client-modal-overlay"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <div className="v2-client-modal-header kani-modal-header">
            <DialogTitle>{editing === "new" ? "Nuevo cliente" : "Editar cliente"}</DialogTitle>
            <KaniModalClose label="Cerrar" />
          </div>
          <form onSubmit={save} className="v2-client-editor-form v2-form">
            <div className="v2-client-modal-scroll kani-modal-body">
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
            <footer className="v2-client-modal-footer kani-modal-footer">
              <button type="submit" className="v2-primary" disabled={saving}>
                {saving ? "Guardando…" : "Guardar cliente"}
              </button>
            </footer>
          </form>
        </DialogContent>
      </Dialog>

      <div className="v2-client-sticky-bar" role="region" aria-label="Acciones de clientes">
        <button
          type="button"
          className="v2-primary v2-client-add-btn v2-client-add-btn--mobile"
          onClick={() => openEditor()}
        >
          <Plus size={17} aria-hidden="true" />
          <span>Nuevo cliente</span>
        </button>
      </div>
    </main>
  );
}
