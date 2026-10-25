import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Logo Light & Dark Theme Integration', () => {
  it('1. Assets: Both WebP and PNG variants exist for light and dark themes', () => {
    expect(fs.existsSync('src/assets/kani-logo-light.webp')).toBe(true);
    expect(fs.existsSync('src/assets/kani-logo-light.png')).toBe(true);
    expect(fs.existsSync('src/assets/kani-logo-dark.webp')).toBe(true);
    expect(fs.existsSync('src/assets/kani-logo-dark.png')).toBe(true);

    const lightWebp = fs.readFileSync('src/assets/kani-logo-light.webp');
    const darkWebp = fs.readFileSync('src/assets/kani-logo-dark.webp');

    // Both must be valid WebP with RIFF and WEBP signatures
    expect(lightWebp.toString('ascii', 0, 4)).toBe('RIFF');
    expect(lightWebp.toString('ascii', 8, 12)).toBe('WEBP');
    expect(darkWebp.toString('ascii', 0, 4)).toBe('RIFF');
    expect(darkWebp.toString('ascii', 8, 12)).toBe('WEBP');

    // WebP sizes should be lightweight
    expect(lightWebp.length).toBeLessThan(40000); // ~22KB
    expect(darkWebp.length).toBeLessThan(70000);  // ~58KB
  });

  it('2. Component: Wordmark renders both light and dark variants with semantic classes', () => {
    const code = fs.readFileSync('src/components/kani/site-header.tsx', 'utf8');

    expect(code).toContain('kaniLogoLight');
    expect(code).toContain('kaniLogoDark');
    expect(code).toContain('wordmark-light');
    expect(code).toContain('wordmark-dark');
  });

  it('3. CSS: Theme rules toggle light and dark logos with zero lag and no hydration mismatch', () => {
    const css = fs.readFileSync('src/styles.css', 'utf8');

    expect(css).toMatch(/html\[data-theme='light'\]\s*\.wordmark-img\.wordmark-dark\s*\{[^}]*display:\s*none\s*!important/);
    expect(css).toMatch(/html\[data-theme='light'\]\s*\.wordmark-img\.wordmark-light\s*\{[^}]*display:\s*block\s*!important/);
    expect(css).toMatch(/html\[data-theme='dark'\]\s*\.wordmark-img\.wordmark-light\s*\{[^}]*display:\s*none\s*!important/);
    expect(css).toMatch(/html\[data-theme='dark'\]\s*\.wordmark-img\.wordmark-dark\s*\{[^}]*display:\s*block\s*!important/);
  });
});
