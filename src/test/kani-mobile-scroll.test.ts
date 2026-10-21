import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio - Mobile Scroll & Viewport Navigation', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const siteHeaderPath = path.resolve(__dirname, '../components/kani/site-header.tsx');
  const rootRoutePath = path.resolve(__dirname, '../routes/__root.tsx');

  const css = fs.readFileSync(stylesPath, 'utf-8');
  const siteHeaderCode = fs.readFileSync(siteHeaderPath, 'utf-8');
  const rootRouteCode = fs.readFileSync(rootRoutePath, 'utf-8');

  it('1. Root html y body configuran scroll continuo y evitan aislamiento de capas en body', () => {
    // html tiene overflow-x: clip y text-size-adjust
    expect(css).toMatch(/html\s*\{[^}]*overflow-x:\s*clip/);
    expect(css).toMatch(/html\s*\{[^}]*-webkit-text-size-adjust:\s*100%/);

    // body no debe contener isolation: isolate ni position: relative que separen la capa de scroll
    expect(css).not.toMatch(/body\s*\{[^}]*isolation:\s*isolate/);
    expect(css).not.toMatch(/body\s*\{[^}]*position:\s*relative/);

    // body debe soportar unidades dinámicas de viewport (100dvh)
    expect(css).toMatch(/body\s*\{[^}]*min-height:\s*100dvh/);

    // body::before no debe usar 'cover fixed' que rompe el scroll en WebKit/iOS Safari
    expect(css).not.toMatch(/body::before\s*\{[^}]*cover fixed/);
    expect(css).toMatch(/html\[data-theme="light"\] body::before\s*\{[^}]*cover no-repeat/);
    expect(css).toMatch(/html\[data-theme="dark"\] body::before\s*\{[^}]*cover no-repeat/);
  });

  it('2. Shell y progreso en mobile no desbordan ni fuerzan anchos fijos', () => {
    // .site-shell utiliza min-height: 100dvh en mobile
    expect(css).toMatch(/@media\(max-width:767px\)\s*\{[^}]*\.site-shell\s*\{[^}]*min-height:\s*100dvh/);

    // .booking-progress tiene protección de ancho y no desborda horizontalmente
    expect(css).toMatch(/\.booking-progress\s*\{[^}]*width:\s*100%;\s*max-width:\s*100%/);
  });

  it('3. Formulario en mobile aplica 16px para evitar auto-zoom de iOS Safari que bloquea el scroll', () => {
    // Inputs en mobile tienen 16px
    expect(css).toMatch(/\.booking-page form input\[name="name"\][^{]*\{[^}]*font-size:\s*16px/);

    // Inputs en desktop conservan 14px
    expect(css).toMatch(/@media\s*\(min-width:\s*768px\)\s*\{[^}]*\.booking-page form input\[name="name"\][^{]*\{[^}]*font-size:\s*14px/);
  });

  it('4. SiteHeader limpia estilos de scroll lock y evita restaurar posición cruzada entre rutas', () => {
    // Debe almacenar la ruta al abrirse
    expect(siteHeaderCode).toContain('openPathRef.current = path;');

    // Solo restaura la posición si permanece en la misma ruta
    expect(siteHeaderCode).toContain('window.location.pathname === openPathRef.current');

    // Debe incluir guardia de seguridad que limpie inline styles residuales en body
    expect(siteHeaderCode).toContain("!menuOpen && (body.style.position === 'fixed' || body.style.overflow === 'hidden')");
    expect(siteHeaderCode).toContain("body.style.position = '';");
    expect(siteHeaderCode).toContain("body.style.overflow = '';");
  });

  it('5. Viewport meta tag en __root.tsx incluye viewport-fit=cover', () => {
    expect(rootRouteCode).toContain('viewport-fit=cover');
  });
});
