import { useState, type FormEvent } from "react";
import { ArrowRight, Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStaff } from "@/lib/kani-admin-context";
import { sortClients, type ClientOrder } from "./client-order";
import { clientHistory } from "@/lib/kani-v2";
import { money } from "@/lib/kani-model";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useV2, type V2Client } from "./data";
import { Empty, Metric, Status } from "./shared";

export function V2Clients() {
  const data = useV2();
  const staff = useAdminStaff();
  const isAdmin = staff.profile.role === "ADMIN";
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
  const rows = sortClients(
    data.clients.filter(
      (c) =>
        !c.archived &&
        !(c as any).deleted_at &&
        `${c.name} ${c.phone} ${c.email || ""}`.toLowerCase().includes(search.toLowerCase()),
    ),
    order,
  );

  function openEditor(client?: V2Client) {
    setEditing(client ?? "new");
    setName(client?.name ?? "");
    setPhone(client?.phone ?? "");
    setEmail(client?.email ?? "");
    setErrorNotice("");
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

      if (rpcError) {
        // Fallback: intentar actualizar deleted_at directamente
        const { error: updateError } = await supabase
          .from("clients")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", clientId);
        if (updateError) throw updateError;
      }

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
      <div className="v2-client-toolbar">
        <label className="v2-search">
          <Search size={18} />
          <input
            aria-label="Buscar clientes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nombre, celular o email"
          />
        </label>
        <label className="v2-field v2-client-order">
          Ordenar por
          <select value={order} onChange={(e) => setOrder(e.target.value as ClientOrder)}>
            <option value="newest">Más recientes</option>
            <option value="oldest">Más antiguos</option>
            <option value="name-asc">Nombre A–Z</option>
            <option value="name-desc">Nombre Z–A</option>
          </select>
        </label>
        <button className="v2-primary" onClick={() => openEditor()}>
          <Plus size={17} />
          Nuevo cliente
        </button>
      </div>
      <div className="v2-client-grid">
        {!rows.length && <Empty>No hay clientes para esta búsqueda.</Empty>}
        {rows.map((c) => {
          const history = clientHistory(c.id, data.appointments, data.payments);
          return (
            <button className="v2-client-card" key={c.id} onClick={() => setSelectedId(c.id)}>
              <span className="v2-avatar">{c.name[0]}</span>
              <h2>{c.name}</h2>
              <div className="v2-client-contact">
                <p>{c.phone || "Sin celular"}</p>
                <p className="v2-truncate">{c.email || "Sin email"}</p>
              </div>
              <div className="v2-client-meta">
                <span>{history.visits} visitas verificadas</span>
                <span>Ficha existente</span>
              </div>
              <ArrowRight className="v2-client-arrow" size={18} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="v2-dialog v2-client-dialog">
          <DialogTitle>{selected?.name}</DialogTitle>
          <DialogDescription>
            Historial de atenciones registradas {isAdmin ? "en Kani" : "en tu actividad"}.
          </DialogDescription>
          {selected && summary && (
            <>
              <div className="v2-metrics">
                <Metric label="Visitas verificadas" value={summary.visits} />
                <Metric
                  label="Valor de servicios registrados"
                  value={money(summary.recordedSpend)}
                />
                <Metric label="Cancelaciones" value={summary.cancellations} />
                <Metric label="Última visita" value={summary.lastVisit ?? "Sin registro"} />
              </div>
              <p className="v2-footnote">
                Cliente desde {selected.created_at.slice(0, 10)} · Frecuencia:{" "}
                {summary.frequency !== null
                  ? `cada ${summary.frequency} días entre visitas registradas`
                  : "historial insuficiente"}
                .
              </p>
              <div className="v2-contact">
                <a href={`tel:${selected.phone.replace(/[^+\d]/g, "")}`}>{selected.phone}</a>
                {selected.email && <a href={`mailto:${selected.email}`}>{selected.email}</a>}
              </div>
              <h3>Historial</h3>
              {!summary.history.length && (
                <Empty>
                  Sin atenciones vinculadas actualmente.
                </Empty>
              )}
              {summary.history
                .slice()
                .reverse()
                .map((a) => (
                  <div className="v2-history-row" key={a.id}>
                    <div>
                      <h3>
                        {a.name ? `${a.name} · ` : ""}{a.serviceName} · {a.barber}
                      </h3>
                      <p>
                        {a.date} · {a.time}
                      </p>
                    </div>
                    <Status code={a.statusCode} />
                  </div>
                ))}
              <div className="v2-dialog-actions" style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                <button
                  className="v2-secondary"
                  onClick={() => {
                    setSelectedId(null);
                    openEditor(selected);
                  }}
                >
                  Editar cliente
                </button>
                {isAdmin && (
                  <button
                    className="v2-destructive"
                    onClick={() => setConfirmDelete(selected)}
                  >
                    Eliminar cliente
                  </button>
                )}
              </div>
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
        <DialogContent className="v2-dialog">
          <DialogTitle>¿Eliminar este cliente?</DialogTitle>
          <DialogDescription>
            {confirmDelete?.name} dejará de figurar en la lista de clientes activos. Se preservará todo su historial de turnos y pagos pasados.
          </DialogDescription>
          {errorNotice && (
            <p role="alert" className="v2-alert">
              {errorNotice}
            </p>
          )}
          <div className="v2-dialog-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
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
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !saving) setEditing(null);
        }}
      >
        <DialogContent className="v2-dialog">
          <DialogTitle>{editing === "new" ? "Nuevo cliente" : "Editar cliente"}</DialogTitle>
          <DialogDescription>
            Los datos se guardan de forma permanente en Supabase.
          </DialogDescription>
          {errorNotice && (
            <p role="alert" className="v2-alert">
              {errorNotice}
            </p>
          )}
          <form onSubmit={save} className="v2-form">
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
            <button className="v2-primary" disabled={saving}>
              {saving ? "Guardando…" : "Guardar cliente"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
