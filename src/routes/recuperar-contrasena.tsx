import { createFileRoute } from "@tanstack/react-router";
import { StaffRecoveryRequest } from "@/components/kani/staff-password-recovery";
export const Route = createFileRoute("/recuperar-contrasena")({
  component: StaffRecoveryRequest,
  head: () => ({
    meta: [
      { title: "Recuperar contraseña — KANI" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
});
