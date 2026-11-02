import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio — V2 Clientes: fondo #FFFFFFD9 y contraste en buscador', () => {
  const v2CssPath = path.resolve(__dirname, '../components/kani/v2/v2.css');
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const clientsTsxPath = path.resolve(__dirname, '../components/kani/v2/clients.tsx');

  const v2Css = fs.readFileSync(v2CssPath, 'utf8');
  const stylesCss = fs.readFileSync(stylesPath, 'utf8');
  const clientsTsx = fs.readFileSync(clientsTsxPath, 'utf8');

  it('1. El componente V2Clients define el input con placeholder "Nombre, celular o email" dentro de v2-client-search-row', () => {
    expect(clientsTsx).toContain('placeholder="Nombre, celular o email"');
    expect(clientsTsx).toContain('v2-client-search-row');
    expect(clientsTsx).toContain('v2-search');
  });

  it('2. Aplica background-color #FFFFFFD9 específicamente al contenedor/input de ese campo', () => {
    // En v2.css
    expect(v2Css).toMatch(/\.v2-client-search-row\s+\.v2-search[^{]*\{[^}]*background-color:\s*#FFFFFFD9\s*!important/i);
    expect(v2Css).toMatch(/\.v2-client-search-row\s+\.v2-search\s+input[^{]*\{[^}]*background-color:\s*#FFFFFFD9\s*!important/i);

    // En styles.css
    expect(stylesCss).toMatch(/\.v2-client-search-row\s+\.v2-search[^{]*\{[^}]*background-color:\s*#FFFFFFD9\s*!important/i);
  });

  it('3. Garantiza contraste legible para texto, placeholder e icono sobre el fondo #FFFFFFD9', () => {
    // Texto oscuro y caret
    expect(v2Css).toMatch(/\.v2-client-search-row\s+\.v2-search\s+input[^{]*\{[^}]*color:\s*#111111\s*!important/i);
    expect(v2Css).toMatch(/\.v2-client-search-row\s+\.v2-search\s+input[^{]*\{[^}]*caret-color:\s*#111111\s*!important/i);

    // Placeholder legible
    expect(v2Css).toMatch(/\.v2-client-search-row\s+\.v2-search\s+input::placeholder[^{]*\{[^}]*color:\s*#555555\s*!important/i);

    // Ícono legible
    expect(v2Css).toMatch(/\.v2-client-search-row\s+\.v2-search\s+svg[^{]*\{[^}]*color:\s*#333333\s*!important/i);
  });

  it('4. Mantiene dimensiones (44px) y bordes de control', () => {
    expect(v2Css).toMatch(/\.v2-client-search-row\s+\.v2-search\s+input[^{]*\{[^}]*height:\s*44px/);
    expect(v2Css).toMatch(/\.v2-client-search-row\s+\.v2-search\s+input[^{]*\{[^}]*min-height:\s*44px/);
  });

  it('5. No afecta otros campos de búsqueda como el diálogo manual', () => {
    // .v2-client-quick-search en manual-appointment-dialog no tiene #FFFFFFD9
    expect(v2Css).not.toMatch(/\.v2-client-quick-search\s*\{[^}]*background-color:\s*#FFFFFFD9/i);
  });
});
