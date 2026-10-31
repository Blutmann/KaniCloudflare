import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio - Ajustes en Contacto e integración de Google Maps', () => {
  const estudioPath = path.resolve(__dirname, '../routes/estudio.tsx');
  const stylesPath = path.resolve(__dirname, '../styles.css');

  const estudioCode = fs.readFileSync(estudioPath, 'utf-8');
  const css = fs.readFileSync(stylesPath, 'utf-8');

  it('1. Elimina por completo el texto «Bajá un cambio. Sentite vos.» sin alterar el resto', () => {
    // No debe contener el texto eliminado
    expect(estudioCode).not.toContain('Bajá un cambio');
    expect(estudioCode).not.toContain('Sentite vos');

    // Debe conservar el resto de los textos y estructura de Contacto
    expect(estudioCode).toContain('Kani Barber Studio');
    expect(estudioCode).toContain('Contacto');
    expect(estudioCode).toContain('Ubicación');
    expect(estudioCode).toContain('San Isidro Labrador 7');
    expect(estudioCode).toContain('Martinez, Provincia de Buenos Aires');
    expect(estudioCode).toContain('Provincia de Buenos Aires');
    expect(estudioCode).toContain('Horarios');
    expect(estudioCode).toContain('Lunes a sábados');
    expect(estudioCode).toContain('10:00 a 20:00 hs');
    expect(estudioCode).toContain('Instagram');
    expect(estudioCode).toContain('@kanibarberstudio');
    expect(estudioCode).toContain('Solicitar turno');
  });

  it('2. Integra Google Maps oficial con el establecimiento Kani Barber Studio', () => {
    // Contiene la card de mapa al final
    expect(estudioCode).toContain('studio-map-card');
    expect(estudioCode).toContain('studio-map-iframe');

    // Utiliza el iframe oficial con el CID de Kani Barber Studio
    expect(estudioCode).toMatch(/KANI_MAPS_EMBED_URL|5241343871369591392/);
    expect(estudioCode).toMatch(/src=\{mapsEmbedUrl\}|src="https:\/\/maps\.google\.com\/maps\?cid=5241343871369591392/);

    // Accesibilidad: título descriptivo
    expect(estudioCode).toContain('title="Ubicación de Kani Barber Studio en Google Maps"');
    expect(estudioCode).toContain('loading="lazy"');

    // Alternativa visible para abrir en Google Maps
    expect(estudioCode).toContain('Cómo llegar');
    expect(estudioCode).toMatch(/KANI_MAPS_URL|https:\/\/www\.google\.com\/maps\/place\/KANI\+BARBER\+STUDIO/);
  });

  it('3. Aplica diseño responsive coherente en mobile y desktop', () => {
    // Card estilizada con identidad de Kani
    expect(css).toMatch(/\.studio-map-card\s*\{[^}]*border-radius:\s*var\(--radius-card/);
    expect(css).toMatch(/\.studio-map-card\s*\{[^}]*overflow:\s*hidden/);

    // Desktop: formato apaisado / ancho
    expect(css).toMatch(/\.studio-map-frame-wrap\s*\{[^}]*height:\s*400px/);

    // Mobile: formato adaptado y vista más alta
    expect(css).toContain('.studio-map-frame-wrap { height: 360px; }');

    // Integración de tema oscuro y claro
    expect(css).toContain("html[data-theme='dark'] .studio-map-card");
    expect(css).toContain("html[data-theme='light'] .studio-map-card");
  });

  it('4. Incorpora card de WhatsApp, elimina encabezados y aplica 2 columnas en mobile', () => {
    // Encabezado eliminado
    expect(estudioCode).not.toContain('studio-page-header');
    expect(estudioCode).not.toContain('<h1 className="section-title">Contacto</h1>');

    // Card de WhatsApp incorporada
    expect(estudioCode).toContain('WhatsApp');
    expect(estudioCode).toContain('Escribinos para realizar tu consulta.');
    expect(estudioCode).toContain('Contactar por WhatsApp');
    expect(estudioCode).toMatch(/KANI_PUBLIC_WHATSAPP_URL|https:\/\/wa\.me\/5491155616438/);

    // 2 columnas en mobile y desktop
    expect(css).toMatch(/\.studio-info-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });

  it('5. Ubicación ocupa exactamente 2 renglones y todas las cards tienen dimensiones uniformes', () => {
    // Dirección en 2 renglones
    expect(estudioCode).toContain('San Isidro Labrador 7<br />Martinez, Provincia de Buenos Aires');

    // Layout estructural uniforme en grid
    expect(css).toMatch(/\.studio-info-grid\s*\{[^}]*grid-auto-rows:\s*1fr/);
    expect(css).toMatch(/\.studio-info-grid\s*\{[^}]*align-items:\s*stretch/);
    expect(css).toMatch(/\.studio-info-card\s*\{[^}]*height:\s*100%/);
    expect(css).toMatch(/\.studio-card-action\s*\{[^}]*margin-top:\s*auto/);
  });
});
