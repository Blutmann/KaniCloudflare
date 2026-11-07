import { createFileRoute } from "@tanstack/react-router";
import { StaffPasswordReset } from "@/components/kani/staff-password-recovery";
export const Route = createFileRoute("/restablecer-contrasena")({
  component: StaffPasswordReset,
  head: () => ({
    meta: [
      { title: "Restablecer contraseña — KANI" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
});
