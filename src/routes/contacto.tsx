import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Copy, ExternalLink, Instagram, MapPin, Play, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingStepHeading } from "@/components/kani/booking-step-heading";
import { buildKaniLocalBusinessJsonLd, pageHead } from "@/lib/kani-head";
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
import type { GoogleReviewsPayload } from "@/lib/kani-google-reviews.server";
import type { InstagramFeedPayload } from "@/lib/kani-instagram-feed.server";
import { getStudioOpenStatus, type StudioOpenStatus } from "@/lib/kani-studio-hours";
import "@/components/kani/experimental/liquid-glass-desktop-v12-22.css";

const mapsUrl = KANI_MAPS_URL;
const mapsEmbedUrl = KANI_MAPS_EMBED_URL;
const instagramUrl = "https://www.instagram.com/kanibarberstudio/";
const whatsAppUrl = KANI_PUBLIC_WHATSAPP_URL;

export const Route = createFileRoute("/contacto")({
  head: () =>
    pageHead(
      "Contacto",
      "Contacto de Kani Barber Studio, ubicación y horarios de atención.",
      "Kani · Contacto",
      {
        canonicalPath: "https://www.kanibarber.com/contacto",
        ogTitle: "Kani Barber Studio · Contacto y Ubicación",
        jsonLd: buildKaniLocalBusinessJsonLd("https://www.kanibarber.com/contacto"),
      },
    ),
  component: StudioPage,
});

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
  const [studioStatus, setStudioStatus] = useState<StudioOpenStatus>(() => getStudioOpenStatus());
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [reviewsState, setReviewsState] = useState<{
    loading: boolean;
    data: GoogleReviewsPayload | null;
  }>({ loading: true, data: null });
  const [instagramState, setInstagramState] = useState<{
    loading: boolean;
    data: InstagramFeedPayload | null;
  }>({ loading: true, data: null });
  const ctaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const syncNavState = () => {
      setNavState(resolveContactoBookingNavState());
      setStudioStatus(getStudioOpenStatus());
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
    if (typeof fetch !== "function") {
      setReviewsState({ loading: false, data: null });
      return;
    }
    const controller = new AbortController();
    fetch("/api/google-reviews", { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<GoogleReviewsPayload>) : null))
      .then((data) => {
        if (!controller.signal.aborted) {
          setReviewsState({ loading: false, data });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setReviewsState({ loading: false, data: null });
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (typeof fetch !== "function") {
      setInstagramState({ loading: false, data: null });
      return;
    }
    const controller = new AbortController();
    fetch("/api/instagram-feed", { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<InstagramFeedPayload>) : null))
      .then((data) => {
        if (!controller.signal.aborted) {
          setInstagramState({ loading: false, data });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setInstagramState({ loading: false, data: null });
        }
      });
    return () => {
      controller.abort();
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

  const handleCopyAddress = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(KANI_STUDIO_ADDRESS);
        setCopiedAddress(true);
        window.setTimeout(() => setCopiedAddress(false), 2000);
      }
    } catch {
      // Ignore clipboard permission errors cleanly
    }
  };

  const liveReviews = reviewsState.data?.reviews ?? [];
  const hasLiveReviews = reviewsState.data?.source === "google_places" && liveReviews.length > 0;
  const effectiveReviewUrl = resolvedReviewUrl ?? reviewsState.data?.reviewUrl ?? null;
  const instagramItems = (instagramState.data?.items ?? []).slice(0, 3);
  const hasInstagramFeed =
    !instagramState.loading &&
    instagramState.data?.source !== "fallback" &&
    instagramItems.length > 0;

  return (
    <div className="booking-page kani-contacto-booking-page">
      <div className="booking-scroll-content kani-contacto-scroll-content">
        <main className="site-container studio-page contacto-page kani-contacto-main">
          <div className="kani-contacto-heading-row">
            <BookingStepHeading title="Contactanos" />
            <span
              className={`kani-contacto-status-pill ${studioStatus.isOpen ? "is-open" : "is-closed"}`}
              suppressHydrationWarning
            >
              <span className="kani-contacto-status-dot" aria-hidden="true" />
              <span>{studioStatus.label}</span>
            </span>
          </div>

          {/* 1. Instagram Feed 3×1 (con fallback automático a fila compacta) */}
          <section
            className="kani-contacto-ig-section"
            aria-label="Últimas publicaciones de Instagram"
          >
            {instagramState.loading || hasInstagramFeed ? (
              <div className="studio-info-card kani-contacto-ig-card">
                <div className="kani-contacto-ig-header">
                  <div className="kani-contacto-ig-identity">
                    <span className="studio-card-icon-wrap kani-contacto-ig-icon" aria-hidden="true">
                      <Instagram className="studio-info-icon" size={18} />
                    </span>
                    <div className="kani-contacto-social-copy">
                      <h2 className="studio-card-title">Instagram</h2>
                      <p className="studio-card-desc">@kanibarberstudio</p>
                    </div>
                  </div>
                  <a
                    href={instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="studio-card-action kani-contacto-ig-profile-link"
                    aria-label="Ver perfil de Kani Barber Studio en Instagram"
                  >
                    Ver perfil <ExternalLink size={13} aria-hidden="true" />
                  </a>
                </div>

                {instagramState.loading ? (
                  <div className="kani-contacto-ig-grid" aria-hidden="true">
                    {[0, 1, 2].map((index) => (
                      <div key={index} className="kani-contacto-ig-tile kani-contacto-ig-shimmer" />
                    ))}
                  </div>
                ) : (
                  <div className="kani-contacto-ig-grid" role="list">
                    {instagramItems.map((item, index) => {
                      const isVideo = item.mediaType === "VIDEO" || item.mediaType === "REELS";
                      const imageSrc = item.thumbnailUrl || item.mediaUrl;
                      const altText = item.caption
                        ? item.caption
                        : `Publicación ${index + 1} de @kanibarberstudio en Instagram`;

                      return (
                        <a
                          key={item.id}
                          href={item.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          role="listitem"
                          className="kani-contacto-ig-tile"
                          aria-label={
                            isVideo
                              ? `Ver reel de @kanibarberstudio en Instagram: ${altText}`
                              : `Ver publicación de @kanibarberstudio en Instagram: ${altText}`
                          }
                        >
                          <img
                            src={imageSrc}
                            alt={altText}
                            loading="lazy"
                            decoding="async"
                            className="kani-contacto-ig-img"
                          />
                          {isVideo ? (
                            <span className="kani-contacto-ig-video-badge" aria-hidden="true">
                              <Play size={11} fill="currentColor" strokeWidth={0} />
                            </span>
                          ) : null}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <a
                className="studio-info-card studio-info-link kani-contacto-social-card kani-contacto-ig-fallback"
                href={instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Ver perfil de Kani Barber Studio en Instagram"
              >
                <div className="kani-contacto-ig-identity">
                  <span className="studio-card-icon-wrap" aria-hidden="true">
                    <Instagram className="studio-info-icon" size={18} />
                  </span>
                  <div className="kani-contacto-social-copy">
                    <h2 className="studio-card-title">Instagram</h2>
                    <p className="studio-card-desc">@kanibarberstudio</p>
                  </div>
                </div>
                <span className="studio-card-action">
                  Ver perfil <ExternalLink size={13} aria-hidden="true" />
                </span>
              </a>
            )}
          </section>

          {/* 2. Card Maestra unificada de Google: Ubicación, horarios, mapa y reseñas */}
          <section
            className="studio-map-card kani-contacto-location-card"
            aria-label="Ubicación, horarios y reseñas de Kani Barber Studio"
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
                  <div className="kani-contacto-location-actions">
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="studio-map-link kani-contacto-directions-link"
                      aria-label="Abrir Kani Barber Studio en Google Maps para obtener indicaciones"
                    >
                      Cómo llegar <ExternalLink size={14} aria-hidden="true" />
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyAddress}
                      className="kani-contacto-copy-btn"
                      aria-label="Copiar dirección del estudio"
                    >
                      {copiedAddress ? (
                        <>
                          <Check size={13} aria-hidden="true" />
                          <span>¡Copiada!</span>
                        </>
                      ) : (
                        <>
                          <Copy size={13} aria-hidden="true" />
                          <span>Copiar dirección</span>
                        </>
                      )}
                    </button>
                  </div>
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

            <div
              className="kani-contacto-reviews-embedded"
              aria-label="Reseñas de clientes en Google"
            >
              {reviewsState.loading ? (
                <div className="kani-contacto-reviews-skeleton is-embedded" aria-hidden="true">
                  <div className="kani-contacto-skeleton-line is-short" />
                  <div className="kani-contacto-skeleton-line" />
                </div>
              ) : hasLiveReviews ? (
                <div className="kani-contacto-reviews-live">
                  <div className="kani-contacto-reviews-header">
                    <div className="kani-contacto-reviews-summary">
                      <span className="kani-contacto-reviews-score">
                        <Star size={15} className="kani-contacto-review-star is-filled" aria-hidden="true" />
                        <strong>{reviewsState.data?.rating?.toFixed(1) ?? "5.0"}</strong>
                      </span>
                      {reviewsState.data?.userRatingCount ? (
                        <span className="kani-contacto-reviews-count">
                          · {reviewsState.data.userRatingCount} reseñas en Google
                        </span>
                      ) : (
                        <span className="kani-contacto-reviews-count">· Reseñas en Google</span>
                      )}
                    </div>
                    <a
                      href={reviewsState.data?.mapsUrl || mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="kani-contacto-reviews-more"
                    >
                      Ver todas <ExternalLink size={13} aria-hidden="true" />
                    </a>
                  </div>
                  <div className="kani-contacto-reviews-carousel" role="list">
                    {liveReviews.map((review, index) => (
                      <article
                        key={`${review.authorName}-${index}`}
                        className="kani-contacto-review-item"
                        role="listitem"
                      >
                        <div className="kani-contacto-review-item-head">
                          <span className="kani-contacto-review-author">{review.authorName}</span>
                          <span
                            className="kani-contacto-review-stars"
                            aria-label={`${review.rating} de 5 estrellas`}
                          >
                            {"★".repeat(Math.max(1, Math.min(5, Math.round(review.rating))))}
                          </span>
                        </div>
                        <p className="kani-contacto-review-text">“{review.text}”</p>
                        {review.relativePublishTimeDescription ? (
                          <span className="kani-contacto-review-date">
                            {review.relativePublishTimeDescription}
                          </span>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="kani-contacto-reviews-fallback-row"
                  aria-label="Ver opiniones de clientes en Google Maps"
                >
                  <span className="kani-contacto-reviews-fallback-label">
                    <Star size={15} className="kani-contacto-review-star is-filled" aria-hidden="true" />
                    <span>Opiniones en Google Maps</span>
                  </span>
                  <span className="kani-contacto-reviews-fallback-cta">
                    Ver reseñas <ExternalLink size={13} aria-hidden="true" />
                  </span>
                </a>
              )}
            </div>

            {effectiveReviewUrl ? (
              <div className="kani-contacto-review-row">
                <span className="kani-contacto-review-prompt">
                  <Star size={15} className="kani-contacto-review-star" aria-hidden="true" />
                  <span>¿Ya nos visitaste?</span>
                </span>
                <a
                  href={effectiveReviewUrl}
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

          <p className="kani-contacto-whatsapp-micro">
            <span>¿Tenés alguna consulta?</span>{" "}
            <a
              href={whatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="kani-contacto-whatsapp-micro-link"
              aria-label="Escribinos por WhatsApp a Kani Barber Studio"
            >
              Escribinos por WhatsApp
            </a>
          </p>
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
