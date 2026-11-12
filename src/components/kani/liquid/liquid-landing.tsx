import { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  Clock,
  Coffee,
  Compass,
  ExternalLink,
  Flame,
  Heart,
  Instagram,
  MapPin,
  MessageCircle,
  Phone,
  Scissors,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
} from 'lucide-react';
import {
  services as fallbackServices,
  barbers,
  barberInstagramHandles,
  barberInstagramUrls,
  money,
  type Barber,
  type ServiceId,
} from '@/lib/kani-model';
import {
  readConfiguredServices,
  type ConfiguredService,
} from '@/lib/kani-availability';
import {
  KANI_MAPS_URL,
  KANI_STUDIO_FULL_ADDRESS,
  KANI_PUBLIC_WHATSAPP_URL,
  KANI_PUBLIC_WHATSAPP_NUMBER,
} from '@/lib/kani-constants';
import { useKani } from '@/components/kani/store';

// Barberos habilitados exclusivamente para reservas públicas (Franco queda resguardado en admin/gestión)
export const PUBLIC_RESERVABLE_BARBERS: Barber[] = ['Lautaro', 'Gonzalo', 'Valentín'];

interface LiquidLandingProps {
  onStartBooking: (params?: { service?: ServiceId; barber?: Barber }) => void;
  configuredServices?: ConfiguredService[];
}

export function LiquidLanding({ onStartBooking, configuredServices: initialServices }: LiquidLandingProps) {
  const { theme } = useKani();
  const [servicesList, setServicesList] = useState<ConfiguredService[]>(initialServices ?? []);

  useEffect(() => {
    if (initialServices && initialServices.length > 0) return;
    let active = true;
    void readConfiguredServices()
      .then((data) => {
        if (active && data.length > 0) {
          setServicesList(data);
        }
      })
      .catch(() => {
        // Fallback to static services
        if (active) {
          setServicesList(fallbackServices as unknown as ConfiguredService[]);
        }
      });
    return () => {
      active = false;
    };
  }, [initialServices]);

  const priceByService = useMemo(() => {
    const map: Record<string, number> = {
      corte: 25000,
      'corte-barba': 30000,
      barba: 15000,
    };
    for (const s of servicesList) {
      if (s.id && s.price) {
        map[s.id] = s.price;
      }
    }
    return map;
  }, [servicesList]);

  return (
    <div className="liquid-landing space-y-16 pb-28 pt-4">
      {/* ====================================================================
          HERO SECTION
          ==================================================================== */}
      <section className="liquid-hero-section relative">
        {/* Subtle Watermark Kanji */}
        <div className="liquid-kanji-watermark pointer-events-none absolute right-[-20px] top-[-10px] w-72 max-w-full select-none opacity-10">
          <img
            src="/liquid/kani-kanji-red.jpg"
            alt=""
            className="w-full mix-blend-multiply dark:mix-blend-screen"
            aria-hidden="true"
          />
        </div>

        <div className="relative z-10 max-w-2xl">
          <div className="liquid-badge-premium">
            <span className="liquid-badge-line" />
            <span>Barbería Premium</span>
            <span className="liquid-badge-line" />
          </div>

          <h1 className="liquid-display-title mb-4 text-4xl sm:text-5xl lg:text-6xl text-[var(--lq-text-primary)]">
            Tu estilo.<br />
            <span className="text-[var(--lq-carmesi)] dark:text-[#ff9fb2]">Tu momento.</span>
          </h1>

          <p className="text-base sm:text-lg text-[var(--lq-text-secondary)] leading-relaxed mb-8 max-w-lg">
            Una experiencia de barbería pensada para vos. Cortes de autor, cuidado integral de barba y el ritual de un espacio donde cada detalle importa.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="liquid-btn-primary"
              onClick={() => onStartBooking()}
            >
              <Calendar size={18} />
              <span>Reservar turno</span>
            </button>

            <a
              href="#servicios"
              className="liquid-btn-secondary"
            >
              <span>Conocer servicios</span>
            </a>
          </div>
        </div>

        {/* Quick Selection Pills */}
        <div className="liquid-quick-pills mt-10">
          <div
            className="liquid-quick-pill-card liquid-glass-card-interactive"
            onClick={() => onStartBooking({ service: 'corte' })}
            role="button"
            tabIndex={0}
          >
            <Scissors className="liquid-pill-icon" />
            <span className="liquid-pill-label">Corte</span>
            <span className="text-xs text-[var(--lq-text-muted)] font-medium">
              {money(priceByService.corte || 25000)}
            </span>
          </div>

          <div
            className="liquid-quick-pill-card liquid-glass-card-interactive"
            onClick={() => onStartBooking({ service: 'barba' })}
            role="button"
            tabIndex={0}
          >
            <Flame className="liquid-pill-icon" />
            <span className="liquid-pill-label">Barba</span>
            <span className="text-xs text-[var(--lq-text-muted)] font-medium">
              {money(priceByService.barba || 15000)}
            </span>
          </div>

          <div
            className="liquid-quick-pill-card liquid-glass-card-interactive"
            onClick={() => onStartBooking({ service: 'corte-barba' })}
            role="button"
            tabIndex={0}
          >
            <Sparkles className="liquid-pill-icon" />
            <span className="liquid-pill-label">Corte y barba</span>
            <span className="text-xs text-[var(--lq-text-muted)] font-medium">
              {money(priceByService['corte-barba'] || 30000)}
            </span>
          </div>

          <div
            className="liquid-quick-pill-card liquid-glass-card-interactive"
            onClick={() => onStartBooking({ service: 'corte-barba' })}
            role="button"
            tabIndex={0}
          >
            <Heart className="liquid-pill-icon" />
            <span className="liquid-pill-label">Experiencia KANI</span>
            <span className="text-xs text-[var(--lq-carmesi)] dark:text-[#ff9fb2] font-semibold">
              Completo
            </span>
          </div>
        </div>
      </section>

      {/* ====================================================================
          NUESTROS BARBEROS (PUBLICLY RESERVABLE ONLY)
          ==================================================================== */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="liquid-serif-heading text-xl sm:text-2xl text-[var(--lq-text-primary)]">
              Nuestros barberos
            </h2>
            <p className="text-xs sm:text-sm text-[var(--lq-text-secondary)] mt-0.5">
              Profesionales dedicados con técnica y estilo propio.
            </p>
          </div>
          <span className="text-xs text-[var(--lq-carmesi)] dark:text-[#ff9fb2] font-semibold hidden sm:inline-flex items-center gap-1">
            <Users size={14} /> Equipo KANI
          </span>
        </div>

        <div className="liquid-barbers-grid">
          {PUBLIC_RESERVABLE_BARBERS.map((barberName) => (
            <div
              key={barberName}
              className="liquid-glass-card liquid-barber-card liquid-glass-card-interactive"
              onClick={() => onStartBooking({ barber: barberName })}
              role="button"
              tabIndex={0}
            >
              <div className="liquid-barber-avatar">
                <div className="liquid-barber-avatar-inner">
                  {barberName.charAt(0)}
                </div>
              </div>
              <h3 className="liquid-barber-name">{barberName}</h3>
              <span className="liquid-barber-role">Barbero</span>
              <span className="liquid-barber-handle mb-3">
                {barberInstagramHandles[barberName]}
              </span>
              <button
                type="button"
                className="w-full text-xs font-semibold py-2 px-3 rounded-full bg-[var(--lq-glass-border-subtle)] text-[var(--lq-text-primary)] hover:bg-[var(--lq-carmesi)] hover:text-white transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartBooking({ barber: barberName });
                }}
              >
                Reservar con {barberName}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ====================================================================
          SERVICIOS DESTACADOS (LIVE CATALOG)
          ==================================================================== */}
      <section id="servicios" className="space-y-4">
        <div className="liquid-glass-card liquid-services-card">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-[var(--lq-carmesi)] dark:text-[#ff9fb2]">
              Catálogo oficial
            </span>
            <h2 className="liquid-serif-heading text-2xl sm:text-3xl text-[var(--lq-text-primary)] mt-1 mb-2">
              Servicios destacados
            </h2>
            <p className="text-sm text-[var(--lq-text-secondary)] leading-relaxed mb-6">
              Todos nuestros servicios incluyen lavado de cabello y una bebida de cortesía (café espresso o refrigerio) para acompañar tu visita.
            </p>
            <button
              type="button"
              className="liquid-btn-primary text-sm py-2.5 px-6"
              onClick={() => onStartBooking()}
            >
              Elegir servicio
            </button>
          </div>

          <div className="space-y-1">
            <div
              className="liquid-service-row cursor-pointer"
              onClick={() => onStartBooking({ service: 'corte' })}
            >
              <div>
                <span className="liquid-service-name block font-semibold">Corte clásico o moderno</span>
                <span className="text-xs text-[var(--lq-text-muted)]">45 minutos · Lavado incluido</span>
              </div>
              <span className="liquid-service-price">
                {money(priceByService.corte || 25000)}
              </span>
            </div>

            <div
              className="liquid-service-row cursor-pointer"
              onClick={() => onStartBooking({ service: 'barba' })}
            >
              <div>
                <span className="liquid-service-name block font-semibold">Arreglo de barba</span>
                <span className="text-xs text-[var(--lq-text-muted)]">30 minutos · Perfilado y toalla caliente</span>
              </div>
              <span className="liquid-service-price">
                {money(priceByService.barba || 15000)}
              </span>
            </div>

            <div
              className="liquid-service-row cursor-pointer"
              onClick={() => onStartBooking({ service: 'corte-barba' })}
            >
              <div>
                <span className="liquid-service-name block font-semibold">Corte + barba (Experiencia KANI)</span>
                <span className="text-xs text-[var(--lq-text-muted)]">60 minutos · Cuidado integral</span>
              </div>
              <span className="liquid-service-price">
                {money(priceByService['corte-barba'] || 30000)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          EXPERIENCIA KANI / EL RITUAL
          ==================================================================== */}
      <section className="space-y-6">
        <div>
          <h2 className="liquid-serif-heading text-xl sm:text-2xl text-[var(--lq-text-primary)]">
            El Ritual KANI
          </h2>
          <p className="text-xs sm:text-sm text-[var(--lq-text-secondary)] mt-0.5">
            Más que un corte, un espacio pensado para distenderte.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="liquid-glass-card p-5">
            <Coffee className="w-6 h-6 text-[var(--lq-carmesi)] dark:text-[#ff9fb2] mb-3" />
            <h3 className="font-semibold text-sm mb-1 text-[var(--lq-text-primary)]">Bebida de cortesía</h3>
            <p className="text-xs text-[var(--lq-text-secondary)] leading-relaxed">
              Disfrutá de un espresso de especialidad o bebida fresca durante tu turno.
            </p>
          </div>

          <div className="liquid-glass-card p-5">
            <Scissors className="w-6 h-6 text-[var(--lq-carmesi)] dark:text-[#ff9fb2] mb-3" />
            <h3 className="font-semibold text-sm mb-1 text-[var(--lq-text-primary)]">Técnica de autor</h3>
            <p className="text-xs text-[var(--lq-text-secondary)] leading-relaxed">
              Asesoramiento personalizado adaptado a la forma de tu rostro y tu estilo.
            </p>
          </div>

          <div className="liquid-glass-card p-5">
            <Sparkles className="w-6 h-6 text-[var(--lq-carmesi)] dark:text-[#ff9fb2] mb-3" />
            <h3 className="font-semibold text-sm mb-1 text-[var(--lq-text-primary)]">Lavado capilar</h3>
            <p className="text-xs text-[var(--lq-text-secondary)] leading-relaxed">
              Lavado y acabado con productos de primera línea en todos los cortes.
            </p>
          </div>

          <div className="liquid-glass-card p-5">
            <Clock className="w-6 h-6 text-[var(--lq-carmesi)] dark:text-[#ff9fb2] mb-3" />
            <h3 className="font-semibold text-sm mb-1 text-[var(--lq-text-primary)]">Puntualidad</h3>
            <p className="text-xs text-[var(--lq-text-secondary)] leading-relaxed">
              Respetamos tu tiempo. Tu turno comienza a la hora programada.
            </p>
          </div>
        </div>

        {/* Testimonial card */}
        <div className="liquid-glass-card liquid-testimonial-card">
          <div className="liquid-testimonial-avatar">
            NR
          </div>
          <div className="flex-1">
            <div className="liquid-stars" aria-label="5 de 5 estrellas">
              <Star size={16} fill="currentColor" />
              <Star size={16} fill="currentColor" />
              <Star size={16} fill="currentColor" />
              <Star size={16} fill="currentColor" />
              <Star size={16} fill="currentColor" />
            </div>
            <blockquote className="text-sm sm:text-base italic text-[var(--lq-text-primary)] font-serif leading-relaxed">
              «La mejor barbería de la zona. Excelente atención, ambiente y nivel de corte. Siempre vuelvo.»
            </blockquote>
            <span className="block text-xs font-semibold text-[var(--lq-text-muted)] mt-2">
              — Nicolás R., cliente habitual
            </span>
          </div>
        </div>
      </section>

      {/* ====================================================================
          UBICACIÓN & CONTACTO
          ==================================================================== */}
      <section className="space-y-4">
        <div>
          <h2 className="liquid-serif-heading text-xl sm:text-2xl text-[var(--lq-text-primary)]">
            Estudio & Ubicación
          </h2>
          <p className="text-xs sm:text-sm text-[var(--lq-text-secondary)] mt-0.5">
            Te esperamos en el corazón de Martínez.
          </p>
        </div>

        <div className="liquid-glass-card liquid-location-card">
          <div className="liquid-map-preview">
            <MapPin className="w-8 h-8 text-[var(--lq-carmesi)] dark:text-[#ff9fb2] animate-bounce" />
          </div>

          <div>
            <h3 className="font-bold text-base text-[var(--lq-text-primary)] mb-1">
              KANI Barber Studio
            </h3>
            <p className="text-xs sm:text-sm text-[var(--lq-text-secondary)] flex items-center gap-1.5 mb-1">
              <MapPin size={14} className="text-[var(--lq-carmesi)] flex-shrink-0" />
              {KANI_STUDIO_FULL_ADDRESS}
            </p>
            <p className="text-xs sm:text-sm text-[var(--lq-text-muted)] flex items-center gap-1.5">
              <Clock size={14} className="flex-shrink-0" />
              Lunes a sábados · 10:00 a 20:00 hs
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <a
              href={KANI_MAPS_URL}
              target="_blank"
              rel="noreferrer"
              className="liquid-btn-secondary text-xs py-2 px-4"
            >
              <span>Abrir Maps</span>
              <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </section>

      {/* ====================================================================
          FLOATING MOBILE BOTTOM DOCK
          ==================================================================== */}
      <div className="liquid-bottom-dock md:hidden">
        <a
          href={`tel:+${KANI_PUBLIC_WHATSAPP_NUMBER}`}
          className="liquid-dock-action"
          title="Llamar"
        >
          <Phone size={15} />
          <span>Llamar</span>
        </a>

        <a
          href={KANI_PUBLIC_WHATSAPP_URL}
          target="_blank"
          rel="noreferrer"
          className="liquid-dock-action"
          title="WhatsApp"
        >
          <MessageCircle size={15} className="text-[#25D366]" />
          <span>WhatsApp</span>
        </a>

        <button
          type="button"
          className="liquid-dock-action primary"
          onClick={() => onStartBooking()}
        >
          <Calendar size={15} />
          <span>Reservar</span>
        </button>
      </div>
    </div>
  );
}
