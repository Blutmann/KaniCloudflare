import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/estudio")({
  beforeLoad: () => {
    throw redirect({
      to: "/contacto",
      statusCode: 301,
    });
  },
});
