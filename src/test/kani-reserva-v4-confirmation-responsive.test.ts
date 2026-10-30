import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Reserva V4 — Confirmación Responsive & CSS Architecture', () => {
  const cssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  it('1. Desktop Grid: define áreas semánticas para alinear horizontalmente encabezados y card ↔ mapa', () => {
    expect(css).toMatch(/grid-template-areas:\s*["']summary-header\s+place-header["']\s+["']summary-card\s+place-map["']\s+["']actions\s+actions["']/);
    expect(css).toMatch(/\.payway-reservation\s+\.confirmation-header-summary\s*\{[^}]*grid-area:\s*summary-header/);
    expect(css).toMatch(/\.payway-reservation\s+\.confirmation-header-place\s*\{[^}]*grid-area:\s*place-header/);
    expect(css).toMatch(/\.payway-reservation\s+\.confirmation-details\s*\{[^}]*grid-area:\s*summary-card/);
    expect(css).toMatch(/\.payway-reservation\s+\.confirmation-map-wrap\s*\{[^}]*grid-area:\s*place-map/);
    expect(css).toMatch(/\.payway-reservation\s+\.confirmation-actions\s*\{[^}]*grid-area:\s*actions/);
  });

  it('2. Tipografía y encabezados consistentes entre ambas columnas', () => {
    expect(css).toMatch(/\.payway-reservation\s+\.confirmation-section-title\s*\{[^}]*font-size:\s*18px/);
    expect(css).toMatch(/\.payway-reservation\s+\.confirmation-section-title\s*\{[^}]*font-weight:\s*600/);
    expect(css).toMatch(/\.payway-reservation\s+\.confirmation-section-subtitle\s*\{[^}]*color:\s*var\(--muted-foreground\)/);
  });

  it('3. Acciones secundarias: Cómo llegar e Instagram en 2 columnas balanceadas', () => {
    expect(css).toMatch(/\.payway-reservation\s+\.confirmation-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.payway-reservation\s+\.confirmation-actions\s+\.confirmation-secondary\s*\{[^}]*height:\s*48px/);
  });

  it('4. Navegación inferior: Volver al inicio reutiliza el sistema booking-cta de Reserva V4', () => {
    expect(css).toMatch(/\.payway-reservation\s+\.confirmation-cta\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/\.payway-reservation\s+\.confirmation-cta\s+\.booking-cta-inner/);
    expect(css).toMatch(/\.payway-reservation\s+\.confirmation-cta\s+\.confirmation-btn-home\s*\{[^}]*height:\s*48px/);
  });

  it('5. Mobile (< 860px): Columna única, scroll natural, mapa proporcionado y botón al 100%', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*859px\)[\s\S]*?\.payway-reservation\s+\.confirmation-grid\s*\{[^}]*flex-direction:\s*column/);
    expect(css).toMatch(/@media\s*\(max-width:\s*859px\)[\s\S]*?\.payway-reservation\s+\.confirmation-map-wrap\s*\{[^}]*height:\s*200px/);
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)[\s\S]*?\.payway-reservation\s+\.confirmation-cta\s+\.confirmation-btn-home\s*\{[^}]*width:\s*100%/);
  });

  it('6. Despeje de scroll: el contenedor tiene padding inferior para que el botón fijo no tape Instagram ni Cómo llegar', () => {
    expect(css).toMatch(/\.payway-reservation\s+\.confirmation\s*\{[^}]*padding-bottom:\s*96px/);
    expect(css).toMatch(/@media\s*\(max-width:\s*859px\)[\s\S]*?\.payway-reservation\s+\.confirmation\s*\{[^}]*padding-bottom:\s*calc\(96px/);
  });
});
