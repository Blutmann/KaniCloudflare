import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import server from '../server';

describe('Google Search Console — Verificación de Propiedad', () => {
  const fileName = 'googleb98699670c2c80a6.html';
  const expectedContent = 'google-site-verification: googleb98699670c2c80a6.html';
  const publicFilePath = path.resolve(__dirname, '../../public', fileName);

  it('1. El archivo existe en public/ con el nombre exacto y contenido íntegro', () => {
    expect(fs.existsSync(publicFilePath)).toBe(true);
    const content = fs.readFileSync(publicFilePath, 'utf8');
    expect(content).toBe(expectedContent);
    expect(fs.statSync(publicFilePath).size).toBe(53);
  });

  it('2. El servidor responde HTTP 200 OK directamente con Content-Type text/html y sin redirección', async () => {
    const testUrl = `https://kanibarberstudio-cloudflare.kanibarber.workers.dev/${fileName}`;
    const request = new Request(testUrl, { method: 'GET' });

    const response = await server.fetch(request, {}, {});

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const body = await response.text();
    expect(body).toBe(expectedContent);
  });

  it('3. Responde correctamente también en el dominio de producción', async () => {
    const prodUrl = `https://kanibarber.com/${fileName}`;
    const request = new Request(prodUrl, { method: 'GET' });

    const response = await server.fetch(request, {}, {});

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const body = await response.text();
    expect(body).toBe(expectedContent);
  });
});
