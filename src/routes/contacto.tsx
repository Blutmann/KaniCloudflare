import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ExternalLink, Instagram, MapPin, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingStepHeading } from "@/components/kani/booking-step-heading";
import { pageHead } from "@/lib/kani-head";
import { LiquidGlassShell } from "@/components/kani/experimental/liquid-glass-shell";
import {
  KANI_GOOGLE_REVIEW_URL,
  KANI_MAPS_URL,
  KANI_MAPS_EMBED_URL,
  KANI_PUBLIC_WHATSAPP_URL,
  KANI_STUDIO_ADDRESS,
  KANI_STUDIO_NAME,
} from "@/lib/kani-constants";
import {
  clearConfirmedAndDraftBookingState,
  resolveContactoBookingNavState,
  type ContactoBookingNavState,
} from "@/lib/kani-booking-draft";
import "@/components/kani/experimental/liquid-glass-desktop-v12-22.css";

const mapsUrl = KANI_MAPS_URL;
const mapsEmbedUrl = KANI_MAPS_EMBED_URL;
const instagramUrl = "https://www.instagram.com/kanibarberstudio/";
const whatsAppUrl = KANI_PUBLIC_WHATSAPP_URL;

export const Route = createFileRoute("/contacto")({
  head: () => ({
    ...pageHead(
      "Contacto",
      "Contacto de Kani Barber Studio, ubicación y horarios de atención.",
      "Kani Barber Studio - Contacto",
    ),
    links: [
      { rel: "canonical", href: "https://www.kanibarber.com/contacto" },
    ],
  }),
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
  const navigate = useNavigate();
  return (
    <LiquidGlassShell section="contact">
      <ContactoContent
        bookingPath="/reservar"
        onBookingNavigate={(to) => {
          void navigate({ to });
        }}
      />
    </LiquidGlassShell>
  );
}

export function ContactoContent({
  bookingPath = "/reservar",
  onBookingNavigate,
  googleReviewUrl = KANI_GOOGLE_REVIEW_URL,
}: {
  bookingPath?: string;
  onBookingNavigate?: (to: string) => void;
  googleReviewUrl?: string | null;
}) {
  const resolvedReviewUrl = googleReviewUrl?.trim() ? googleReviewUrl.trim() : null;
  const [navState, setNavState] = useState<ContactoBookingNavState>({
    mode: "new",
    label: "Reservar un turno",
  });
  const ctaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const syncNavState = () => {
      setNavState(resolveContactoBookingNavState());
    };
    syncNavState();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        syncNavState();
      }
    };
    window.addEventListener("focus", syncNavState);
    window.addEventListener("storage", syncNavState);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", syncNavState);
      window.removeEventListener("storage", syncNavState);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    const cta = ctaRef.current;
    if (!cta || typeof document === "undefined") return;
    const updateHeight = () => {
      document.documentElement.style.setProperty(
        "--booking-cta-height",
        `${cta.getBoundingClientRect().height}px`,
      );
    };
    updateHeight();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateHeight) : null;
    observer?.observe(cta);
    window.addEventListener("resize", updateHeight);
    window.visualViewport?.addEventListener("resize", updateHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateHeight);
      window.visualViewport?.removeEventListener("resize", updateHeight);
      document.documentElement.style.removeProperty("--booking-cta-height");
    };
  }, []);

  const handleBookingCtaClick = () => {
    if (navState.mode === "another") {
      clearConfirmedAndDraftBookingState();
    }
    if (onBookingNavigate) {
      onBookingNavigate(bookingPath);
      return;
    }
    if (typeof window !== "undefined") {
      window.location.assign(bookingPath);
    }
  };

  return (
    <div className="booking-page kani-contacto-booking-page">
      <div className="booking-scroll-content kani-contacto-scroll-content">
        <main className="site-container studio-page contacto-page kani-contacto-main">
          <BookingStepHeading title="Contactanos" />

          <div className="studio-info-grid kani-contacto-social-grid">
            {/* 1. Instagram */}
            <a
              className="studio-info-card studio-info-link kani-contacto-social-card"
              href={instagramUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Ver perfil de Kani Barber Studio en Instagram"
            >
              <div className="studio-card-top">
                <span className="studio-card-icon-wrap" aria-hidden="true">
                  <Instagram className="studio-info-icon" size={20} />
                </span>
                <div className="kani-contacto-social-copy">
                  <h2 className="studio-card-title">Instagram</h2>
                  <p className="studio-card-desc">@kanibarberstudio</p>
                </div>
              </div>
              <span className="studio-card-action">
                Ver perfil <ExternalLink size={14} aria-hidden="true" />
              </span>
            </a>

            {/* 2. WhatsApp */}
            <a
              className="studio-info-card studio-info-link kani-contacto-social-card"
              href={whatsAppUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Escribinos por WhatsApp a Kani Barber Studio"
            >
              <div className="studio-card-top">
                <span className="studio-card-icon-wrap" aria-hidden="true">
                  <WhatsAppIcon className="studio-info-icon" size={20} />
                </span>
                <div className="kani-contacto-social-copy">
                  <h2 className="studio-card-title">WhatsApp</h2>
                  <p className="studio-card-desc">Hablemos por acá</p>
                </div>
              </div>
              <span className="studio-card-action">
                Escribinos <ExternalLink size={14} aria-hidden="true" />
              </span>
            </a>
          </div>

          {/* 3. Ubicación, horarios y mapa interactivo */}
          <section
            className="studio-map-card kani-contacto-location-card"
            aria-label="Ubicación y horarios de Kani Barber Studio"
          >
            <div className="studio-map-header kani-contacto-location-header">
              <div className="studio-map-header-info kani-contacto-location-info">
                <span className="studio-card-icon-wrap kani-contacto-location-icon" aria-hidden="true">
                  <MapPin className="studio-info-icon" size={20} />
                </span>
                <div className="kani-contacto-location-copy">
                  <h2 className="studio-map-title">{KANI_STUDIO_NAME}</h2>
                  <p className="studio-map-address">{KANI_STUDIO_ADDRESS}</p>
                  <p className="kani-contacto-hours">Lunes a sábados · 10:00 a 20:00</p>
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="studio-map-link kani-contacto-directions-link"
                    aria-label="Abrir Kani Barber Studio en Google Maps para obtener indicaciones"
                  >
                    Cómo llegar <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </div>
              </div>
            </div>
            <div className="studio-map-frame-wrap kani-contacto-map-wrap">
              <iframe
                src={mapsEmbedUrl}
                title="Ubicación de Kani Barber Studio en Google Maps"
                className="studio-map-iframe"
                loading="lazy"
                allowFullScreen
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
            {resolvedReviewUrl ? (
              <div className="kani-contacto-review-row">
                <span className="kani-contacto-review-prompt">
                  <Star size={15} className="kani-contacto-review-star" aria-hidden="true" />
                  <span>¿Ya nos visitaste?</span>
                </span>
                <a
                  href={resolvedReviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="kani-contacto-review-link"
                  aria-label="Dejanos tu reseña sobre Kani Barber Studio en Google Maps"
                >
                  <span>Dejanos tu reseña</span>
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              </div>
            ) : null}
          </section>
        </main>
      </div>

      <div
        ref={ctaRef}
        className="booking-cta kani-contacto-cta"
        role="region"
        aria-label="Navegación de reserva"
      >
        <div className="booking-cta-inner flex items-center">
          <Button
            type="button"
            className="booking-next-button kani-contacto-cta-btn"
            aria-label={navState.label}
            onClick={handleBookingCtaClick}
          >
            {navState.label}
          </Button>
        </div>
      </div>
    </div>
  );
}
