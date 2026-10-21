import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Instagram, MapPin, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pageHead } from "@/lib/kani-head";

const mapsUrl =
  "https://www.google.com/maps/place/KANI+BARBER+STUDIO/data=!4m2!3m1!1s0x0:0x48bcfe7b2ea7ba60";
const mapsEmbedUrl =
  "https://maps.google.com/maps?cid=5241343871369591392&hl=es&output=embed";
const instagramUrl = "https://www.instagram.com/kanibarberstudio/";

export const Route = createFileRoute("/estudio")({
  head: () =>
    pageHead(
      "Contacto",
      "Contacto de Kani Barber Studio, ubicación y horarios de atención.",
      "Kani Barber Studio - Contacto",
    ),
  component: StudioPage,
});

function StudioPage() {
  return (
    <main className="site-container studio-page">
      <div className="studio-page-header">
        <div>
          <p className="eyebrow">Kani Barber Studio</p>
          <h1 className="section-title">Contacto</h1>
        </div>
      </div>
      <div className="studio-info-grid">
        <a className="studio-info-card studio-info-link" href={mapsUrl} target="_blank" rel="noreferrer" aria-label="Abrir ubicación de Kani Barber Studio en Google Maps">
          <MapPin className="studio-info-icon" size={22} />
          <div>
            <h2>Ubicación</h2>
            <p>San Isidro Labrador 7, Martínez<br />Provincia de Buenos Aires</p>
            <span className="studio-card-action">Ver ubicación <ArrowRight size={15} /></span>
          </div>
        </a>
        <Link className="studio-info-card studio-info-link" to="/reservar" aria-label="Solicitar un turno en Kani Barber Studio">
          <Clock3 className="studio-info-icon" size={22} />
          <div>
            <h2>Horarios</h2>
            <p>Lunes a sábados<br />10:00 a 20:00 hs</p>
            <span className="studio-card-action">Solicitar turno <ArrowRight size={15} /></span>
          </div>
        </Link>
        <a className="studio-info-card studio-info-link" href={instagramUrl} target="_blank" rel="noreferrer" aria-label="Abrir Instagram de Kani Barber Studio">
          <Instagram className="studio-info-icon" size={22} />
          <div>
            <h2>Instagram</h2>
            <p>Seguinos en Instagram y conocé nuestro trabajo.</p>
            <span className="studio-card-action">@kanibarberstudio <ArrowRight size={15} /></span>
          </div>
        </a>
      </div>
      <div className="studio-booking-cta-wrap">
        <Button asChild className="studio-booking-cta action-positive">
          <Link to="/reservar">
            Solicitar turno <ArrowRight />
          </Link>
        </Button>
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
