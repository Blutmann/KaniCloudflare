import type { MouseEvent } from "react";
import { Mail, Pencil, Trash2, UserRound } from "lucide-react";
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
        <UserRound size={16} aria-hidden="true" />
        <h2 title={client.name}>{client.name}</h2>
      </div>
      {canDelete && <button type="button" className="v2-client-action-btn delete" onClick={onDelete} title="Eliminar cliente" aria-label="Eliminar cliente"><Trash2 size={15} aria-hidden="true" /></button>}
      <div className="v2-client-mobile-email v2-client-mobile-info">
        <Mail size={16} aria-hidden="true" />
        {email && !/[\r\n]/.test(email)
          ? <a href={`mailto:${encodeURIComponent(email)}`} onClick={stop} title={email} aria-label={`Enviar correo a ${email}`}><span>{email}</span></a>
          : <span className="v2-client-mobile-empty">Sin email</span>}
      </div>
      {canEdit && <button type="button" className="v2-client-action-btn edit" onClick={onEdit} title="Editar cliente" aria-label="Editar cliente"><Pencil size={15} aria-hidden="true" /></button>}
      <div className="v2-client-mobile-phone v2-client-mobile-info">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" /></svg>
        {whatsapp
          ? <a href={whatsapp} target="_blank" rel="noopener noreferrer" onClick={stop} aria-label={`Abrir WhatsApp de ${client.name}`}><span>{formatStoredPhone(client.phone)}</span></a>
          : <span className="v2-client-mobile-empty" title="No hay un celular válido para abrir WhatsApp">{client.phone || "Sin celular"}</span>}
      </div>
      <button type="button" className="v2-secondary v2-client-details-btn" onClick={onDetails}>Detalles</button>
    </div>
  );
}
