export const STAFF_RECOVERY_MESSAGE =
  "Si el correo corresponde a una cuenta habilitada, recibirás un enlace para restablecer tu contraseña.";
export const STAFF_RECOVERY_URL = "https://www.kanibarber.com/restablecer-contrasena";
export const STAFF_RECOVERY_MIN_PASSWORD = 12;

// Supabase Auth hashes email OTPs with SHA-224. The provider still verifies purpose and expiry.
export function isStaffRecoveryToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{56}$/i.test(value);
}
