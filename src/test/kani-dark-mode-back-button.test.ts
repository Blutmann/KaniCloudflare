import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio — Botón «Volver» en Modo Oscuro (Diseño Sólido Sin Transparencias)', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const stylesCss = fs.readFileSync(stylesPath, 'utf-8');

  const v4Path = path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css');
  const v4Css = fs.readFileSync(v4Path, 'utf-8');

  describe('1. Estilos Globales (src/styles.css) para Desktop y Mobile en Modo Oscuro', () => {
    it('«Volver» habilitado: fondo gris carbón sólido (#242424), opacidad 1, texto e ícono blancos y sin backdrop-filter', () => {
      // Fondo sólido #242424
      expect(stylesCss).toMatch(
        /html\[data-theme='dark'\] \.booking-back-button\s*\{[^}]*background(-color)?:\s*#242424\s*!important/
      );
      // Sin transparencia para evitar sangrado de la ilustración de fondo
      expect(stylesCss).toMatch(
        /html\[data-theme='dark'\] \.booking-back-button\s*\{[^}]*backdrop-filter:\s*none\s*!important/
      );
      expect(stylesCss).toMatch(
        /html\[data-theme='dark'\] \.booking-back-button\s*\{[^}]*-webkit-backdrop-filter:\s*none\s*!important/
      );
      // Opacidad 1
      expect(stylesCss).toMatch(
        /html\[data-theme='dark'\] \.booking-back-button\s*\{[^}]*opacity:\s*1\s*!important/
      );
      // Texto blanco
      expect(stylesCss).toMatch(
        /html\[data-theme='dark'\] \.booking-back-button\s*\{[^}]*color:\s*#ffffff\s*!important/
      );
      // Borde sutil
      expect(stylesCss).toMatch(
        /html\[data-theme='dark'\] \.booking-back-button\s*\{[^}]*border:\s*1px solid rgba\(255, 255, 255, 0\.15\)\s*!important/
      );
      // Icono blanco
      expect(stylesCss).toMatch(
        /html\[data-theme='dark'\] \.booking-back-button svg\s*\{[^}]*color:\s*#ffffff\s*!important/
      );
    });

    it('«Volver» estados interactivos: hover y pressed perceptibles', () => {
      // Hover / focus
      expect(stylesCss).toMatch(
        /html\[data-theme='dark'\] \.booking-back-button:hover:not\(:disabled\)[^}]*\{[^}]*background(-color)?:\s*#2e2e2e\s*!important/
      );
      // Active / pressed
      expect(stylesCss).toMatch(
        /html\[data-theme='dark'\] \.booking-back-button:active:not\(:disabled\)\s*\{[^}]*background(-color)?:\s*#1a1a1a\s*!important/
      );
    });

    it('«Volver» deshabilitado: mismo lenguaje sólido con opacidad reducida y cursor not-allowed', () => {
      expect(stylesCss).toMatch(
        /html\[data-theme='dark'\] \.booking-back-button:disabled\s*\{[^}]*background(-color)?:\s*#242424\s*!important/
      );
      expect(stylesCss).toMatch(
        /html\[data-theme='dark'\] \.booking-back-button:disabled\s*\{[^}]*opacity:\s*0\.38\s*!important/
      );
      expect(stylesCss).toMatch(
        /html\[data-theme='dark'\] \.booking-back-button:disabled\s*\{[^}]*backdrop-filter:\s*none\s*!important/
      );
      expect(stylesCss).toMatch(
        /html\[data-theme='dark'\] \.booking-back-button:disabled\s*\{[^}]*cursor:\s*not-allowed\s*!important/
      );
    });

    it('Preserva Modo Claro intacto en src/styles.css', () => {
      expect(stylesCss).toMatch(
        /html\[data-theme='light'\] \.booking-back-button\s*\{[^}]*background:\s*var\(--kani-surface\)\s*!important/
      );
    });

    it('Preserva botón «Continuar» (.booking-next-button) sin alteraciones', () => {
      expect(stylesCss).toMatch(
        /html\[data-theme='dark'\] \.booking-next-button:disabled\s*\{[^}]*background:\s*var\(--button-primary-disabled-bg\)\s*!important/
      );
      expect(stylesCss).toMatch(
        /html\[data-theme='dark'\] \.booking-next-button:not\(:disabled\)[^}]*\{[^}]*background:\s*var\(--gold\)\s*!important/
      );
    });
  });

  describe('2. Estilos Específicos Mobile V4 (src/components/kani/experimental/reserva-v4.css)', () => {
    it('Mobile V4 Modo Oscuro: fondo #242424 sólido y sin transparencias en enabled y disabled', () => {
      // Habilitado
      expect(v4Css).toMatch(
        /html\[data-theme="dark"\] \.payway-reservation \.booking-page \.booking-back-button:not\(:disabled\)\s*\{[^}]*background:\s*#242424\s*!important/
      );
      expect(v4Css).toMatch(
        /html\[data-theme="dark"\] \.payway-reservation \.booking-page \.booking-back-button:not\(:disabled\)\s*\{[^}]*backdrop-filter:\s*none\s*!important/
      );
      expect(v4Css).toMatch(
        /html\[data-theme="dark"\] \.payway-reservation \.booking-page \.booking-back-button:not\(:disabled\)\s*\{[^}]*opacity:\s*1\s*!important/
      );

      // Deshabilitado
      expect(v4Css).toMatch(
        /html\[data-theme="dark"\] \.payway-reservation \.booking-page \.booking-back-button:disabled\s*\{[^}]*background:\s*#242424\s*!important/
      );
      expect(v4Css).toMatch(
        /html\[data-theme="dark"\] \.payway-reservation \.booking-page \.booking-back-button:disabled\s*\{[^}]*opacity:\s*0\.38\s*!important/
      );
      expect(v4Css).toMatch(
        /html\[data-theme="dark"\] \.payway-reservation \.booking-page \.booking-back-button:disabled\s*\{[^}]*cursor:\s*not-allowed\s*!important/
      );
    });

    it('Mobile V4 Modo Claro: permanece intacto con fondo #fff', () => {
      expect(v4Css).toMatch(
        /html\[data-theme="light"\] \.payway-reservation \.booking-page \.booking-back-button:not\(:disabled\)\s*\{[^}]*background:\s*#fff\s*!important/
      );
    });
  });
});
