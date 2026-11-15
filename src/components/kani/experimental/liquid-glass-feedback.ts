const CONFIRMATION_SOUND_STORAGE_KEY = 'kani:liquid-glass:confirmation-sound-enabled';
const PLAYED_SOUND_IDS_STORAGE_KEY = 'kani:liquid-glass:played-confirmation-sound-ids';

export type HapticKind = 'select' | 'reconfirm';

const HAPTIC_DURATION_MS: Record<HapticKind, number> = {
  select: 10,
  reconfirm: 6,
};

let sharedAudioCtx: AudioContext | null = null;
const playedIdsMemory = new Set<string>();

function isReducedMotionActive(explicitReducedMotion?: boolean): boolean {
  if (explicitReducedMotion) return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function isHapticSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/**
 * Ejecuta una vibración breve y discreta solo cuando el navegador soporta navigator.vibrate
 * de forma estándar y no está activo prefers-reduced-motion. Sin técnicas no oficiales.
 */
export function triggerSelectionHaptic(kind: HapticKind, reducedMotion = false): boolean {
  if (isReducedMotionActive(reducedMotion) || !isHapticSupported()) {
    return false;
  }
  try {
    return Boolean(navigator.vibrate(HAPTIC_DURATION_MS[kind]));
  } catch {
    return false;
  }
}

/**
 * Desactivado por defecto hasta que el usuario habilite la experiencia sonora.
 */
export function readConfirmationSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(CONFIRMATION_SOUND_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeConfirmationSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONFIRMATION_SOUND_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    /* Storage access is best-effort. */
  }
}

function readPlayedIds(): Set<string> {
  const merged = new Set(playedIdsMemory);
  if (typeof window === 'undefined') return merged;
  try {
    const raw = window.sessionStorage.getItem(PLAYED_SOUND_IDS_STORAGE_KEY);
    if (!raw) return merged;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === 'string' && item) merged.add(item);
      }
    }
  } catch {
    /* Ignore malformed or restricted storage. */
  }
  return merged;
}

export function hasPlayedConfirmationSound(appointmentId?: string | null): boolean {
  if (!appointmentId) return false;
  return readPlayedIds().has(appointmentId);
}

export function markConfirmationSoundPlayed(appointmentId?: string | null): void {
  if (!appointmentId) return;
  playedIdsMemory.add(appointmentId);
  if (typeof window === 'undefined') return;
  try {
    const next = [...readPlayedIds()];
    window.sessionStorage.setItem(PLAYED_SOUND_IDS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Ignore storage errors. */
  }
}

type AudioContextConstructor = typeof AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const win = window as Window & { webkitAudioContext?: AudioContextConstructor };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

function getOrCreateAudioContext(): AudioContext | null {
  const Ctor = getAudioContextConstructor();
  if (!Ctor) return null;
  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new Ctor();
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * Desbloquea silenciosamente el contexto de audio dentro de un gesto explícito del usuario
 * sin emitir ningún sonido, para cumplir las políticas de reproducción automática.
 */
export function unlockConfirmationAudio(): boolean {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      void ctx.resume().catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

function scheduleCrystallineChime(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  const filter = typeof ctx.createBiquadFilter === 'function' ? ctx.createBiquadFilter() : null;

  if (filter) {
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600, now);
    if (typeof filter.frequency.exponentialRampToValueAtTime === 'function') {
      filter.frequency.exponentialRampToValueAtTime(1400, now + 0.48);
    }
    filter.Q.setValueAtTime(0.65, now);
    filter.connect(masterGain);
  }
  masterGain.connect(ctx.destination);
  masterGain.gain.setValueAtTime(1, now);

  // Tres parciales cálidos y suaves (~515 ms totales): ataque sedoso y caída cristalina extendida sin estridencias.
  const partials = [
    { freq: 587.33, startOffset: 0, attack: 0.022, peakGain: 0.036, duration: 0.44 }, // D5 fundamental cálido
    { freq: 880.0, startOffset: 0.065, attack: 0.024, peakGain: 0.03, duration: 0.45 }, // A5 quinta cristalina suave
    { freq: 1174.66, startOffset: 0.075, attack: 0.026, peakGain: 0.008, duration: 0.34 }, // D6 halo sutil
  ] as const;

  for (const partial of partials) {
    const start = now + partial.startOffset;
    const peakAt = start + partial.attack;
    const end = start + partial.duration;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(partial.freq, start);

    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(partial.peakGain, peakAt);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(env);
    env.connect(filter ?? masterGain);

    osc.start(start);
    osc.stop(end + 0.02);
  }
}

/**
 * Reproduce una campanilla cristalina suave de ~515 ms exclusivamente tras confirmar una reserva real.
 * Respeta la preferencia opt-in (desactivada por defecto) y evita repeticiones para la misma reserva.
 */
export function playConfirmationChime(
  appointmentId?: string | null,
  options?: { enabled?: boolean },
): boolean {
  const isEnabled = options?.enabled ?? readConfirmationSoundEnabled();
  if (!isEnabled) return false;
  if (appointmentId && hasPlayedConfirmationSound(appointmentId)) return false;

  const ctx = getOrCreateAudioContext();
  if (!ctx) return false;

  try {
    if (appointmentId) {
      markConfirmationSoundPlayed(appointmentId);
    }

    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      void ctx
        .resume()
        .then(() => {
          if (ctx.state === 'running') {
            scheduleCrystallineChime(ctx);
          }
        })
        .catch(() => {});
      return true;
    }

    scheduleCrystallineChime(ctx);
    return true;
  } catch {
    return false;
  }
}

export function __resetLiquidGlassFeedbackForTests(): void {
  playedIdsMemory.clear();
  sharedAudioCtx = null;
}
