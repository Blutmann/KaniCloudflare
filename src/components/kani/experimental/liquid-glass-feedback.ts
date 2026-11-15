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
 * Activado por defecto en Liquid Glass salvo que el usuario elija silenciarlo explícitamente.
 */
export function readConfirmationSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(CONFIRMATION_SOUND_STORAGE_KEY) !== 'false';
  } catch {
    return true;
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
    filter.frequency.setValueAtTime(2400, now);
    if (typeof filter.frequency.exponentialRampToValueAtTime === 'function') {
      filter.frequency.exponentialRampToValueAtTime(1150, now + 0.86);
    }
    filter.Q.setValueAtTime(0.55, now);
    filter.connect(masterGain);
  }
  masterGain.connect(ctx.destination);
  masterGain.gain.setValueAtTime(0.88, now);

  // Resonancia cristalina cálida (~890 ms totales): ataque sedoso, cuerpo aterciopelado y cola armónica suave.
  const partials = [
    { freq: 293.66, startOffset: 0, attack: 0.034, peakGain: 0.012, duration: 0.72 }, // D4 cuerpo cálido sutil
    { freq: 587.33, startOffset: 0, attack: 0.028, peakGain: 0.034, duration: 0.84 }, // D5 fundamental sereno
    { freq: 880.0, startOffset: 0.075, attack: 0.032, peakGain: 0.028, duration: 0.815 }, // A5 quinta cristalina (finaliza ~890 ms)
    { freq: 1174.66, startOffset: 0.095, attack: 0.036, peakGain: 0.0075, duration: 0.62 }, // D6 halo etéreo contenido
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
 * Reproduce una campanilla cristalina cálida y suave (~890 ms) exclusivamente tras confirmar una reserva real.
 * Activa por defecto en Liquid Glass con opción de silencio persistida y sin interferir si el navegador bloquea el audio.
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
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      void ctx
        .resume()
        .then(() => {
          if (ctx.state === 'running' && (!appointmentId || !hasPlayedConfirmationSound(appointmentId))) {
            if (appointmentId) markConfirmationSoundPlayed(appointmentId);
            scheduleCrystallineChime(ctx);
          }
        })
        .catch(() => {});
      return true;
    }

    if (appointmentId) {
      markConfirmationSoundPlayed(appointmentId);
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
