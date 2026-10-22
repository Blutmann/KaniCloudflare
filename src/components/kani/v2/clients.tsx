import { useState, type FormEvent } from "react";
import { Archive, ArrowRight, Plus, Search, UserRound } from "lucide-react";
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
  const selected = data.clients.find((c) => c.id === selectedId);
  const summary = selected ? clientHistory(selected.id, data.appointments, data.payments) : null;
  const rows = sortClients(
    data.clients.filter(
      (c) =>
        !c.archived &&
        `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(search.toLowerCase()),
    ),
    order,
  );
  function openEditor(client?: V2Client) {
    setEditing(client ?? "new");
    setName(client?.name ?? "");
    setPhone(client?.phone ?? "");
    setEmail(client?.email ?? "");
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2 || phone.replace(/\D/g, "").length < 6) return;
    const now = new Date().toISOString();
    if (editing && editing !== "new")
      data.setClients((rows) =>
        rows.map((c) =>
          c.id === editing.id
            ? { ...c, name: name.trim(), phone: phone.trim(), email: email.trim() }
            : c,
        ),
      );
    else
      data.setClients((rows) => [
        ...rows,
        {
          id: `draft-${crypto.randomUUID()}`,
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          created_at: now,
          updated_at: now,
          draft: true,
        },
      ]);
    setEditing(null);
    setNotice("Propuesta guardada solo en esta sesión. No se modificó la base de clientes.");
  }
  return (
    <main className="v2-page">
      <div className="v2-callout">
        <UserRound size={22} />
        <div>
          <h2>Historial real. Edición en evaluación.</h2>
          <p>
            Las fichas y los turnos provienen de pruebas. Crear, editar y archivar son una propuesta
            local: se restablecen al recargar o actualizar los datos. No se fusionan clientes
            automáticamente.
          </p>
        </div>
      </div>
      {notice && (
        <p role="status" className="v2-success">
          {notice}
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
                <span>
                  {c.archived
                    ? "Archivado · propuesta"
                    : c.draft
                      ? "Alta de prueba local"
                      : "Ficha existente"}
                </span>
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
            Historial disponible {isAdmin ? "en Kani" : "en tu actividad"}. Los datos derivados no
            se guardan en la ficha.
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
                . El gasto solo incluye cobros vinculados por ID de turno.
              </p>
              <div className="v2-contact">
                <a href={`tel:${selected.phone.replace(/[^+\d]/g, "")}`}>{selected.phone}</a>
                {selected.email && <a href={`mailto:${selected.email}`}>{selected.email}</a>}
              </div>
              <h3>Historial</h3>
              {!summary.history.length && (
                <Empty>
                  Sin atenciones vinculadas. Los cobros sin turno todavía no tienen relación con la
                  ficha.
                </Empty>
              )}
              {summary.history
                .slice()
                .reverse()
                .map((a) => (
                  <div className="v2-history-row" key={a.id}>
                    <div>
                      <h3>
                        {a.serviceName} · {a.barber}
                      </h3>
                      <p>
                        {a.date} · {a.time}
                      </p>
                    </div>
                    <Status code={a.statusCode} />
                  </div>
                ))}
              <div className="v2-dialog-actions">
                <button
                  className="v2-secondary"
                  onClick={() => {
                    setSelectedId(null);
                    openEditor(selected);
                  }}
                >
                  Probar edición
                </button>
                {isAdmin && (
                  <button
                    className="v2-quiet"
                    onClick={() => {
                      data.setClients((rows) =>
                        rows.map((c) =>
                          c.id === selected.id ? { ...c, archived: !c.archived } : c,
                        ),
                      );
                      setSelectedId(null);
                      setNotice(
                        "Archivo de prueba aplicado solo en esta sesión. El historial se conserva.",
                      );
                    }}
                  >
                    <Archive size={16} />
                    {selected.archived ? "Restaurar" : "Archivar"} · propuesta
                  </button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="v2-dialog">
          <DialogTitle>
            {editing === "new" ? "Alta rápida · propuesta" : "Editar ficha · propuesta"}
          </DialogTitle>
          <DialogDescription>
            Podés evaluar el formulario. No se guardará en Supabase ni se deduplicarán personas.
          </DialogDescription>
          <form onSubmit={save} className="v2-form">
            <label className="v2-field">
              Nombre
              <input
                required
                minLength={2}
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
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label className="v2-field">
              Email · opcional
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="v2-primary">Guardar propuesta local</button>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
