/** Label test notifications without changing production subjects. */
export function notificationSubject(subject: string, environment?: string, supabaseUrl?: string) {
  const label = environment?.trim().toUpperCase() || "UNCONFIGURED";
  let testProject = false;
  try {
    testProject = new URL(supabaseUrl ?? "").hostname === "iockpxtkflyjfagkvgnr.supabase.co";
  } catch {
    /* Missing/invalid URLs do not identify an environment. */
  }
  if (
    testProject ||
    ["DEV/PREVIEW", "PREVIEW", "DEV", "DEVELOPMENT", "TEST", "PRUEBA"].includes(label)
  ) {
    return `[PRUEBA] ${subject}`;
  }
  return label === "PRODUCTION" ? subject : `[${label}] ${subject}`;
}
