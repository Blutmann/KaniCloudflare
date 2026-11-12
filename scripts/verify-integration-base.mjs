import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

const branch = run('git branch --show-current');
const head = run('git rev-parse --short HEAD');
const mainHead = run('git rev-parse --short main');

console.log(`[verify-integration-base] Branch: ${branch} (${head}) | main: ${mainHead}`);

const requiredMarkers = [
  {
    file: 'src/routes/membresia.$token.tsx',
    patterns: ['VIP CLIENT', 'PRIVATE PASS', 'kani-card-3d-scene', 'kani-kanji-stamp'],
    label: 'Black Card aprobada (54deb27c / 1e3fe4e)',
  },
  {
    file: 'src/components/kani/booking-time-selection.tsx',
    patterns: ['BookingTimeSelection', 'groupSlotsByPeriod'],
    label: 'Selector de horarios Mañana/Tarde (69f1cea)',
  },
  {
    file: 'src/components/kani/booking-slot-recovery.tsx',
    patterns: ['BookingSlotUnavailableRecovery', 'Ese horario ya no está disponible'],
    label: 'Recuperación de disponibilidad en reservas (69f1cea)',
  },
];

let failed = false;
for (const check of requiredMarkers) {
  const fullPath = path.resolve(process.cwd(), check.file);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Falta archivo requerido para ${check.label}: ${check.file}`);
    failed = true;
    continue;
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  const missing = check.patterns.filter(p => !content.includes(p));
  if (missing.length > 0) {
    console.error(`❌ ${check.label} incompleta en ${check.file}. Faltan: ${missing.join(', ')}`);
    failed = true;
  } else {
    console.log(`✅ OK: ${check.label}`);
  }
}

if (failed) {
  console.error('\nAbortando: la rama actual no incluye todas las mejoras aprobadas. Integrá integration/stable-preview antes de publicar.');
  process.exit(1);
}

console.log('\n✅ Base de integración verificada. Podés compilar y publicar Preview con seguridad.');
