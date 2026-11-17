import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio - Contacto V12.47.26 e integración de Google Maps', () => {
  const contactoPath = path.resolve(__dirname, '../routes/contacto.tsx');
  const routesCssPath = path.resolve(__dirname, '../components/kani/experimental/liquid-glass-routes.css');
  const constantsPath = path.resolve(__dirname, '../lib/kani-constants.ts');

  const contactoCode = fs.readFileSync(contactoPath, 'utf-8');
  const routesCss = fs.readFileSync(routesCssPath, 'utf-8');
  const constantsCode = fs.readFileSync(constantsPath, 'utf-8');

  it('1. Reemplaza el diseño anterior de 4 cards por la composición de 3 cards y CTA nativo', () => {
    expect(contactoCode).not.toContain('Bajá un cambio');
    expect(contactoCode).not.toContain('Sentite vos');
    expect(contactoCode).not.toContain('Escribinos para realizar tu consulta');

    expect(contactoCode).toContain('Instagram');
    expect(contactoCode).toContain('@kanibarberstudio');
    expect(contactoCode).toContain('Ver perfil');

    expect(contactoCode).toContain('WhatsApp');
    expect(contactoCode).toContain('Hablemos por acá');
    expect(contactoCode).toContain('Escribinos');

    expect(contactoCode).toContain('KANI_STUDIO_NAME');
    expect(contactoCode).toContain('KANI_STUDIO_ADDRESS');
    expect(constantsCode).toContain('San Isidro Labrador 7, Martínez');
    expect(contactoCode).toContain('Lunes a sábados · 10:00 a 20:00');
  });

  it('2. Integra Google Maps oficial interactivo con el establecimiento Kani Barber Studio', () => {
    expect(contactoCode).toContain('studio-map-card');
    expect(contactoCode).toContain('studio-map-iframe');
    expect(contactoCode).toContain('KANI_MAPS_EMBED_URL');
    expect(contactoCode).toContain('title="Ubicación de Kani Barber Studio en Google Maps"');
    expect(contactoCode).toContain('loading="lazy"');
    expect(contactoCode).toContain('Cómo llegar');
    expect(contactoCode).toContain('KANI_MAPS_URL');
  });

  it('3. Aplica alturas compactas de mapa en mobile (145–160px) y desktop (180–200px) + 2 columnas iguales', () => {
    expect(routesCss).toContain('.kani-contacto-social-grid');
    expect(routesCss).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(routesCss).toContain('grid-auto-rows: 1fr');
    expect(routesCss).toContain('height: 152px !important;');
    expect(routesCss).toContain('height: 192px !important;');
    expect(routesCss).toContain('kani-contacto-cta-btn');
  });
});
