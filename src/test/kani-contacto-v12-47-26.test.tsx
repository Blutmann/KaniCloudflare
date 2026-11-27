// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContactoContent } from '@/routes/contacto';
import {
  BOOKING_DRAFT_STORAGE_KEY,
  resolveContactoBookingNavState,
  saveBookingDraft,
} from '@/lib/kani-booking-draft';
import {
  KANI_MAPS_EMBED_URL,
  KANI_MAPS_URL,
  KANI_PUBLIC_WHATSAPP_URL,
  KANI_STUDIO_ADDRESS,
  KANI_STUDIO_NAME,
} from '@/lib/kani-constants';

describe('Contacto V12.47.26 — Composición, Cards y Navegación Inteligente', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('renderiza título «Contactanos» y 2 bloques principales (Instagram + Card unificada de Google con Ubicación/Mapa/Reseñas) y micro-link de WhatsApp sin repeticiones', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: string | URL) => {
        const url = String(input);
        if (url.includes('/api/instagram-feed')) {
          return Promise.resolve(
            new Response(JSON.stringify({ source: 'fallback', items: [] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ source: 'fallback', reviews: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );

    const { container } = render(<ContactoContent bookingPath="/reservar" />);

    const heading = screen.getByRole('heading', { level: 1, name: 'Contactanos' });
    expect(heading).toBeTruthy();
    expect(heading.className).toContain('booking-step-heading-title');
    expect(heading.className).toContain('section-title');

    // En fallback, Instagram renderiza fila compacta horizontal (sin card dedicada de WhatsApp)
    await waitFor(() => {
      expect(container.querySelector('.kani-contacto-ig-fallback')).toBeTruthy();
    });

    const socialCards = container.querySelectorAll('.kani-contacto-social-card');
    const locationCards = container.querySelectorAll('.kani-contacto-location-card');
    expect(socialCards).toHaveLength(1);
    expect(locationCards).toHaveLength(1);
    expect(container.querySelector('.kani-contacto-whatsapp-card')).toBeNull();
    expect(container.querySelector('.kani-contacto-location-copy .kani-contacto-directions-link')).toBeTruthy();

    // Reseñas de Google integradas dentro de la card de ubicación debajo del mapa
    const locationCard = locationCards[0];
    expect(locationCard.querySelector('.kani-contacto-reviews-embedded')).toBeTruthy();
    const reviewsFallbackLink = locationCard.querySelector('.kani-contacto-reviews-fallback-row');
    expect(reviewsFallbackLink).toBeTruthy();
    expect(reviewsFallbackLink?.textContent).toContain('Opiniones en Google Maps');
    expect(reviewsFallbackLink?.textContent).toContain('Ver reseñas');

    const instagramLinks = screen.getAllByRole('link', {
      name: /Ver perfil de Kani Barber Studio en Instagram/i,
    });
    expect(instagramLinks).toHaveLength(1);
    const instagramLink = instagramLinks[0];
    expect(instagramLink.getAttribute('href')).toBe('https://www.instagram.com/kanibarberstudio/');
    expect(instagramLink.getAttribute('target')).toBe('_blank');
    expect(instagramLink.getAttribute('rel')).toBe('noopener noreferrer');
    expect(instagramLink.textContent).toContain('Instagram');
    expect(instagramLink.textContent).toContain('@kanibarberstudio');
    expect(instagramLink.textContent).toContain('Ver perfil');

    // Micro-link discreto de WhatsApp al pie del scroll
    const whatsappLink = screen.getByRole('link', {
      name: /Escribinos por WhatsApp a Kani Barber Studio/i,
    });
    expect(whatsappLink.getAttribute('href')).toBe(KANI_PUBLIC_WHATSAPP_URL);
    expect(whatsappLink.getAttribute('target')).toBe('_blank');
    expect(whatsappLink.getAttribute('rel')).toBe('noopener noreferrer');
    expect(whatsappLink.textContent).toContain('Escribinos por WhatsApp');

    const directionsLink = screen.getByRole('link', {
      name: /Abrir Kani Barber Studio en Google Maps/i,
    });
    expect(directionsLink.getAttribute('href')).toBe(KANI_MAPS_URL);
    expect(directionsLink.getAttribute('target')).toBe('_blank');
    expect(directionsLink.textContent).toContain('Cómo llegar');

    const iframe = screen.getByTitle('Ubicación de Kani Barber Studio en Google Maps');
    expect(iframe.getAttribute('src')).toBe(KANI_MAPS_EMBED_URL);
    expect(iframe.getAttribute('loading')).toBe('lazy');

    // Nombre, dirección y horarios aparecen una sola vez en toda la página
    const fullText = container.textContent ?? '';
    expect(fullText.split(KANI_STUDIO_NAME).length - 1).toBe(1);
    expect(fullText.split(KANI_STUDIO_ADDRESS).length - 1).toBe(1);
    expect(fullText.split('Lunes a sábados · 10:00 a 20:00').length - 1).toBe(1);

    vi.unstubAllGlobals();
  });

  it('renderiza grilla 3×1 de Instagram con 3 tiles, lazy loading y badge de reel/video cuando el feed responde', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: string | URL) => {
        const url = String(input);
        if (url.includes('/api/instagram-feed')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                source: 'behold',
                items: [
                  {
                    id: 'p1',
                    mediaType: 'IMAGE',
                    mediaUrl: 'https://cdn.behold.so/p1.jpg',
                    thumbnailUrl: null,
                    permalink: 'https://www.instagram.com/p/p1/',
                    caption: 'Fade clásico',
                    timestamp: '2026-11-26T15:00:00Z',
                  },
                  {
                    id: 'p2',
                    mediaType: 'REELS',
                    mediaUrl: 'https://cdn.behold.so/p2-thumb.jpg',
                    thumbnailUrl: 'https://cdn.behold.so/p2-thumb.jpg',
                    permalink: 'https://www.instagram.com/reel/p2/',
                    caption: 'Proceso de corte',
                    timestamp: '2026-11-25T15:00:00Z',
                  },
                  {
                    id: 'p3',
                    mediaType: 'CAROUSEL_ALBUM',
                    mediaUrl: 'https://cdn.behold.so/p3.jpg',
                    thumbnailUrl: null,
                    permalink: 'https://www.instagram.com/p/p3/',
                    caption: 'Detalles del estudio',
                    timestamp: '2026-11-24T15:00:00Z',
                  },
                ],
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ source: 'fallback', reviews: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );

    const { container } = render(<ContactoContent bookingPath="/reservar" />);

    // Durante la carga inicial muestra 3 placeholders shimmer
    expect(container.querySelectorAll('.kani-contacto-ig-shimmer')).toHaveLength(3);

    await waitFor(() => {
      expect(container.querySelectorAll('.kani-contacto-ig-img')).toHaveLength(3);
    });

    const tiles = container.querySelectorAll<HTMLAnchorElement>('.kani-contacto-ig-grid a.kani-contacto-ig-tile');
    expect(tiles).toHaveLength(3);
    expect(tiles[0].getAttribute('href')).toBe('https://www.instagram.com/p/p1/');
    expect(tiles[0].getAttribute('target')).toBe('_blank');
    expect(tiles[0].getAttribute('rel')).toBe('noopener noreferrer');

    const images = container.querySelectorAll<HTMLImageElement>('.kani-contacto-ig-img');
    images.forEach((img) => {
      expect(img.getAttribute('loading')).toBe('lazy');
    });

    // Solo el reel/video tiene el badge de play
    expect(container.querySelectorAll('.kani-contacto-ig-video-badge')).toHaveLength(1);

    // Sigue existiendo un único link al perfil de Instagram
    expect(
      screen.getAllByRole('link', { name: /Ver perfil de Kani Barber Studio en Instagram/i }),
    ).toHaveLength(1);

    vi.unstubAllGlobals();
  });

  it('Caso A: sin reserva previa ni borrador muestra «Reservar un turno» y navega a /reservar', () => {
    const onNavigate = vi.fn();
    render(<ContactoContent bookingPath="/reservar" onBookingNavigate={onNavigate} />);

    const cta = screen.getByRole('button', { name: 'Reservar un turno' });
    expect(cta).toBeTruthy();
    fireEvent.click(cta);
    expect(onNavigate).toHaveBeenCalledWith('/reservar');
  });

  it('Caso B: con borrador válido en curso muestra «Continuar mi reserva» y conserva el borrador', async () => {
    saveBookingDraft({
      service: 'corte',
      barber: 'Kani',
      barberDeferred: false,
      date: '2026-12-20',
      time: '14:00',
      name: 'Juan Perez',
      phone: '',
      phoneCountry: 'AR',
      email: '',
      benefitCode: null,
      lastMeaningfulActivityAt: Date.now(),
    });

    const onNavigate = vi.fn();
    render(<ContactoContent bookingPath="/reservar" onBookingNavigate={onNavigate} />);

    const cta = await screen.findByRole('button', { name: 'Continuar mi reserva' });
    fireEvent.click(cta);

    expect(onNavigate).toHaveBeenCalledWith('/reservar');
    expect(window.localStorage.getItem(BOOKING_DRAFT_STORAGE_KEY)).not.toBeNull();
  });

  it('Caso B (intento de pago activo): sin confirmación previa muestra «Continuar mi reserva»', async () => {
    window.sessionStorage.setItem(
      'kani:payway:active-attempt',
      JSON.stringify({
        appointmentId: 'apt-1',
        attemptId: 'att-1',
        accessToken: 'tok-1',
        depositArs: 5000,
      }),
    );

    const onNavigate = vi.fn();
    render(<ContactoContent bookingPath="/reservar" onBookingNavigate={onNavigate} />);

    const cta = await screen.findByRole('button', { name: 'Continuar mi reserva' });
    fireEvent.click(cta);
    expect(onNavigate).toHaveBeenCalledWith('/reservar');
    expect(window.sessionStorage.getItem('kani:payway:active-attempt')).not.toBeNull();
  });

  it('Caso C: con reserva confirmada muestra «Reservar otro turno» y limpia estado previo antes de navegar', async () => {
    window.sessionStorage.setItem(
      'kani:payway:confirmed-booking',
      JSON.stringify({
        appointmentId: 'apt-confirmed',
        serviceName: 'Corte',
        barber: 'Kani',
        date: '2026-12-20',
        time: '15:00',
        depositArs: 5000,
        servicePriceArs: 20000,
      }),
    );
    window.sessionStorage.setItem(
      'kani:payway:confirmed-booking:v5',
      JSON.stringify({ appointmentId: 'apt-confirmed' }),
    );
    window.localStorage.setItem(
      BOOKING_DRAFT_STORAGE_KEY,
      JSON.stringify({ version: 1 }),
    );

    const onNavigate = vi.fn();
    render(<ContactoContent bookingPath="/reservar" onBookingNavigate={onNavigate} />);

    const cta = await screen.findByRole('button', { name: 'Reservar otro turno' });
    fireEvent.click(cta);

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('/reservar');
    });
    expect(window.sessionStorage.getItem('kani:payway:confirmed-booking')).toBeNull();
    expect(window.sessionStorage.getItem('kani:payway:confirmed-booking:v5')).toBeNull();
    expect(window.localStorage.getItem(BOOKING_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('resolveContactoBookingNavState ignora borradores expirados y cae a Caso A', () => {
    const expiredAt = Date.now() - 2 * 60 * 60 * 1000;
    window.localStorage.setItem(
      BOOKING_DRAFT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        service: 'corte',
        barber: 'Kani',
        barberDeferred: false,
        date: null,
        time: null,
        name: null,
        phone: null,
        phoneCountry: null,
        email: null,
        benefitCode: null,
        lastMeaningfulActivityAt: expiredAt,
        expiresAt: expiredAt + 60 * 60 * 1000,
      }),
    );

    expect(resolveContactoBookingNavState()).toEqual({
      mode: 'new',
      label: 'Reservar un turno',
    });
  });

  it('V12.47.26.3: mantiene la acción de reseña inactiva mientras KANI_GOOGLE_REVIEW_URL sea null y la renderiza debajo del mapa cuando está configurada', async () => {
    const { KANI_GOOGLE_REVIEW_URL } = await import('@/lib/kani-constants');
    expect(KANI_GOOGLE_REVIEW_URL).toBeNull();

    const { rerender, container } = render(
      <ContactoContent bookingPath="/reservar" onBookingNavigate={vi.fn()} />,
    );
    expect(screen.queryByText('Dejanos tu reseña')).not.toBeInTheDocument();

    const officialReviewUrl = 'https://g.page/r/kani-barber-studio-example/review';
    rerender(
      <ContactoContent
        bookingPath="/reservar"
        onBookingNavigate={vi.fn()}
        googleReviewUrl={officialReviewUrl}
      />,
    );

    const locationCard = container.querySelector('.kani-contacto-location-card');
    expect(locationCard?.querySelector('.kani-contacto-review-row')).toBeTruthy();
    expect(screen.getByText('¿Ya nos visitaste?')).toBeInTheDocument();

    const reviewLink = screen.getByRole('link', {
      name: /Dejanos tu reseña sobre Kani Barber Studio en Google Maps/i,
    });
    expect(reviewLink).toHaveAttribute('href', officialReviewUrl);
    expect(reviewLink).toHaveAttribute('target', '_blank');
    expect(reviewLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('previene recorte/desborde en 360px en las tarjetas sociales de /contacto', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const routesCss = fs.readFileSync(
      path.resolve(__dirname, '../components/kani/experimental/liquid-glass-routes.css'),
      'utf-8',
    );
    expect(routesCss).toMatch(
      /@media\s*\(max-width:\s*380px\)[\s\S]*?\.kani-contacto-social-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
    expect(routesCss).toMatch(
      /\.kani-contacto-social-card\s+\.studio-card-desc\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;/,
    );
  });
});
