import type { MouseEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { formatStoredPhone, getWhatsAppUrl } from "@/lib/kani-phone";
import type { V2Client } from "./data";

export function ClientCardMobile({ client, canEdit, canDelete, onDetails, onEdit, onDelete }: {
  client: V2Client;
  canEdit: boolean;
  canDelete: boolean;
  onDetails: () => void;
  onEdit: (event: MouseEvent) => void;
  onDelete: (event: MouseEvent) => void;
}) {
  const whatsapp = getWhatsAppUrl(client.phone);
  const email = client.email?.trim();
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <div className="v2-client-mobile-grid" onClick={stop}>
      <div className="v2-client-mobile-name v2-client-mobile-info">
        <h2 title={client.name}>{client.name}</h2>
      </div>
      {(canEdit || canDelete) && (
        <div className="v2-client-mobile-actions">
          {canEdit && (
            <button
              type="button"
              className="v2-client-action-btn edit"
              onClick={onEdit}
              title="Editar cliente"
              aria-label="Editar cliente"
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="v2-client-action-btn delete"
              onClick={onDelete}
              title="Eliminar cliente"
              aria-label="Eliminar cliente"
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      <div className="v2-client-mobile-email v2-client-mobile-info">
        {email && !/[\r\n]/.test(email)
          ? <a href={`mailto:${encodeURIComponent(email)}`} onClick={stop} title={email} aria-label={`Enviar correo a ${email}`}><span>{email}</span></a>
          : <span className="v2-client-mobile-empty">Sin email</span>}
      </div>
      <div className="v2-client-mobile-phone v2-client-mobile-info">
        {whatsapp
          ? <a href={whatsapp} target="_blank" rel="noopener noreferrer" onClick={stop} aria-label={`Abrir WhatsApp de ${client.name}`}><span>{formatStoredPhone(client.phone)}</span></a>
          : <span className="v2-client-mobile-empty" title="No hay un celular válido para abrir WhatsApp">{client.phone || "Sin celular"}</span>}
      </div>
      <button type="button" className="v2-secondary v2-client-details-btn" onClick={onDetails}>Detalles</button>
    </div>
  );
}
