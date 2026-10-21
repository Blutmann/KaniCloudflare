import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Instagram, MapPin, Clock3 } from "lucide-react";
import { pageHead } from "@/lib/kani-head";

const mapsUrl =
  "https://www.google.com/maps/place/KANI+BARBER+STUDIO/data=!4m2!3m1!1s0x0:0x48bcfe7b2ea7ba60";
const mapsEmbedUrl =
  "https://maps.google.com/maps?cid=5241343871369591392&hl=es&output=embed";
const instagramUrl = "https://www.instagram.com/kanibarberstudio/";
const whatsAppUrl = "https://wa.me/5491128436014";

export const Route = createFileRoute("/estudio")({
  head: () =>
    pageHead(
      "Contacto",
      "Contacto de Kani Barber Studio, ubicación y horarios de atención.",
      "Kani Barber Studio - Contacto",
    ),
  component: StudioPage,
});

function WhatsAppIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
    </svg>
  );
}

function StudioPage() {
  return (
    <main className="site-container studio-page">
      <div className="studio-info-grid">
        {/* 1. Ubicación */}
        <a
          className="studio-info-card studio-info-link"
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Abrir ubicación de Kani Barber Studio en Google Maps"
        >
          <div className="studio-card-top">
            <span className="studio-card-icon-wrap" aria-hidden="true">
              <MapPin className="studio-info-icon" size={20} />
            </span>
            <h2 className="studio-card-title">Ubicación</h2>
          </div>
          <p className="studio-card-desc">
            San Isidro Labrador 7<br />Martinez, Provincia de Buenos Aires
          </p>
          <span className="studio-card-action">
            Ver ubicación <ArrowRight size={13} aria-hidden="true" />
          </span>
        </a>

        {/* 2. Horarios */}
        <Link
          className="studio-info-card studio-info-link"
          to="/reservar"
          aria-label="Solicitar un turno en Kani Barber Studio"
        >
          <div className="studio-card-top">
            <span className="studio-card-icon-wrap" aria-hidden="true">
              <Clock3 className="studio-info-icon" size={20} />
            </span>
            <h2 className="studio-card-title">Horarios</h2>
          </div>
          <p className="studio-card-desc">
            Lunes a sábados<br />10:00 a 20:00 hs
          </p>
          <span className="studio-card-action">
            Solicitar turno <ArrowRight size={13} aria-hidden="true" />
          </span>
        </Link>

        {/* 3. Instagram */}
        <a
          className="studio-info-card studio-info-link"
          href={instagramUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Seguir a Kani Barber Studio en Instagram"
        >
          <div className="studio-card-top">
            <span className="studio-card-icon-wrap" aria-hidden="true">
              <Instagram className="studio-info-icon" size={20} />
            </span>
            <h2 className="studio-card-title">Instagram</h2>
          </div>
          <p className="studio-card-desc">
            Seguinos en Instagram y conocé nuestro trabajo.
          </p>
          <span className="studio-card-action">
            @kanibarberstudio <ArrowRight size={13} aria-hidden="true" />
          </span>
        </a>

        {/* 4. WhatsApp */}
        <a
          className="studio-info-card studio-info-link"
          href={whatsAppUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Contactar a Kani Barber Studio por WhatsApp"
        >
          <div className="studio-card-top">
            <span className="studio-card-icon-wrap" aria-hidden="true">
              <WhatsAppIcon className="studio-info-icon" size={20} />
            </span>
            <h2 className="studio-card-title">WhatsApp</h2>
          </div>
          <p className="studio-card-desc">
            Escribinos para realizar tu consulta.
          </p>
          <span className="studio-card-action">
            Contactar por WhatsApp <ArrowRight size={13} aria-hidden="true" />
          </span>
        </a>
      </div>

      <div className="studio-map-card">
        <div className="studio-map-header">
          <div className="studio-map-header-info">
            <MapPin className="studio-info-icon" size={20} />
            <div>
              <h2 className="studio-map-title">Kani Barber Studio</h2>
              <p className="studio-map-address">San Isidro Labrador 7, Martínez · Buenos Aires</p>
            </div>
          </div>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="studio-map-link"
            aria-label="Abrir Kani Barber Studio en Google Maps para obtener indicaciones"
          >
            Cómo llegar <ArrowRight size={14} />
          </a>
        </div>
        <div className="studio-map-frame-wrap">
          <iframe
            src={mapsEmbedUrl}
            title="Ubicación de Kani Barber Studio en Google Maps"
            className="studio-map-iframe"
            loading="lazy"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
          >
            <p>
              Tu navegador no soporta iframes. Podés{" "}
              <a href={mapsUrl} target="_blank" rel="noreferrer">
                ver la ubicación de Kani Barber Studio directamente en Google Maps
              </a>.
            </p>
          </iframe>
        </div>
      </div>
    </main>
  );
}
