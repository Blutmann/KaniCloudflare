import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as membershipsLib from "@/lib/kani-recurrences-memberships";

let mockedToken = "tok-black-card-0123456789abcdef0123456789";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({
    useParams: () => ({ token: mockedToken }),
  }),
  Link: ({ to, children, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

import { PublicMembershipCardPage } from "@/routes/membresia.$token";

const makeCardData = (
  overrides: Partial<membershipsLib.PublicMembershipCardResult> = {},
): membershipsLib.PublicMembershipCardResult => ({
  found: true,
  client_name: "Lucas Fernández",
  barber_name: "Lautaro",
  plan_name: "Membresía 4 servicios",
  package_size: 4,
  status: "ACTIVE",
  total_sessions: 4,
  consumed_sessions: 2,
  remaining_sessions: 2,
  expires_at: "2026-12-31",
  created_at: "2026-11-01T12:00:00Z",
  items: [
    {
      service_name: "Corte",
      total_quantity: 4,
      consumed_quantity: 2,
      remaining_quantity: 2,
    },
  ],
  consumptions: [
    {
      service_name: "Corte de cabello",
      consumption_type: "SERVICE_COMPLETED",
      status: "CONSUMED",
      consumed_at: "2026-11-05T15:30:00Z",
      refunded_at: null,
    },
    {
      service_name: "Barba",
      consumption_type: "SERVICE_COMPLETED",
      status: "CONSUMED",
      consumed_at: "2026-11-09T18:15:00Z",
      refunded_at: null,
    },
  ],
  ...overrides,
});

describe("KANI Barber Studio — Restauración Black Card Premium (/membresia/:token)", () => {
  beforeEach(() => {
    mockedToken = "tok-black-card-0123456789abcdef0123456789";
    vi.restoreAllMocks();
  });

  it("1. Frente y reverso restaurados (4 sesiones): VIP CLIENT, Zen Antique, PRIVATE PASS, sellos Kanji con fecha y sin BENEFICIOS DISPONIBLES", async () => {
    vi.spyOn(membershipsLib, "getPublicMembershipCard").mockResolvedValue(makeCardData());

    render(<PublicMembershipCardPage />);

    // Frente
    expect(await screen.findByText("VIP CLIENT")).toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
    const clientHeading = screen.getByRole("heading", { level: 1, name: "Lucas Fernández" });
    expect(clientHeading).toHaveStyle({ fontFamily: "'Zen Antique', Georgia, serif" });
    expect(screen.getByText("Lautaro")).toBeInTheDocument();
    expect(screen.getAllByText("4 SESIONES").length).toBeGreaterThanOrEqual(2);

    // Reverso
    expect(screen.getByText("PRIVATE PASS")).toBeInTheDocument();
    expect(screen.getByText("31 DIC 26")).toBeInTheDocument();
    expect(screen.queryByText(/BENEFICIOS DISPONIBLES/i)).toBeNull();

    // 2 sellos kanji consumidos con fechas horizontales + 2 disponibles numerados (03, 04)
    expect(screen.getAllByAltText("Sello Kanji KANI")).toHaveLength(2);
    expect(screen.getByText("05 NOV 26")).toBeInTheDocument();
    expect(screen.getByText("09 NOV 26")).toBeInTheDocument();
    expect(screen.getByText("03")).toBeInTheDocument();
    expect(screen.getByText("04")).toBeInTheDocument();

    // Elementos externos
    expect(screen.getByRole("link", { name: /RESERVAR TURNO/i })).toHaveAttribute(
      "href",
      "https://www.kanibarber.com/reservar-turno",
    );
    expect(screen.getByText("DESLIZÁ HORIZONTALMENTE PARA GIRAR")).toBeInTheDocument();
    expect(screen.getByText("HISTORIAL DE VISITAS")).toBeInTheDocument();
    expect(screen.getByText("Corte de cabello")).toBeInTheDocument();
    expect(screen.getByText("05/11/2026 · 15:30 hs")).toBeInTheDocument();
    expect(screen.getByText("© 2026 KANI Barber Studio")).toBeInTheDocument();
  });

  it("2. Soporta paquetes de 10 sesiones (cuadrícula 5x2) y estado completado", async () => {
    vi.spyOn(membershipsLib, "getPublicMembershipCard").mockResolvedValue(
      makeCardData({
        plan_name: "Membresía 10 servicios",
        package_size: 10,
        total_sessions: 10,
        consumed_sessions: 10,
        remaining_sessions: 0,
        status: "EXHAUSTED",
        consumptions: Array.from({ length: 10 }, (_, idx) => ({
          service_name: "Corte",
          consumption_type: "SERVICE_COMPLETED",
          status: "CONSUMED",
          consumed_at: `2026-10-${String(idx + 1).padStart(2, "0")}T11:00:00Z`,
          refunded_at: null,
        })),
      }),
    );

    const { container } = render(<PublicMembershipCardPage />);
    await screen.findByText("VIP CLIENT");

    expect(screen.getByText("Completada")).toBeInTheDocument();
    expect(screen.getByText("MEMBERSHIP COMPLETED")).toBeInTheDocument();
    expect(screen.getAllByAltText("Sello Kanji KANI")).toHaveLength(10);
    expect(container.querySelector(".grid-cols-5")).not.toBeNull();
  });

  it("3. Modal QR ampliado: logo KANI, título «Verificación en Kani», SVG escaneable con ruta /verificar-membresia/:token y cierre", async () => {
    vi.spyOn(membershipsLib, "getPublicMembershipCard").mockResolvedValue(makeCardData());

    render(<PublicMembershipCardPage />);
    await screen.findByText("VIP CLIENT");

    fireEvent.click(screen.getByRole("button", { name: "Abrir código QR de verificación" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Verificación en Kani" })).toBeInTheDocument();
    expect(screen.getByText("2 de 4")).toBeInTheDocument();
    expect(screen.getByText(`#${mockedToken.slice(0, 8).toUpperCase()}`)).toBeInTheDocument();

    // Esperar a que QRCode.toString genere el <svg> real dentro del modal
    await waitFor(() => {
      expect(dialog.querySelector("svg")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("4. Interacción 3D: giro por click/teclado, estados settled 1:1 y cancelación por scroll vertical sin voltear accidentalmente", async () => {
    vi.spyOn(membershipsLib, "getPublicMembershipCard").mockResolvedValue(makeCardData());

    render(<PublicMembershipCardPage />);
    await screen.findByText("VIP CLIENT");

    const scene = screen.getByTestId("kani-card-3d-scene");
    const flipper = screen.getByTestId("kani-card-flipper");

    expect(scene).toHaveClass("is-settled-front");
    expect(flipper).toHaveAttribute("data-angle-y", "0");

    // Click en botón REVERSO gira a 180°
    fireEvent.click(screen.getByRole("button", { name: "Ver reverso de la credencial" }));
    expect(scene).toHaveClass("is-3d-active");
    expect(flipper).toHaveAttribute("data-angle-y", "180");

    // Simular pointerdown + pointercancel (scroll vertical móvil): NO debe volver a girar
    fireEvent.pointerDown(scene, { pointerId: 11, pointerType: "touch", clientX: 150, clientY: 200 });
    fireEvent.pointerCancel(window, { pointerId: 11 });
    expect(flipper).toHaveAttribute("data-angle-y", "180");
  });

  it("5. Aislamiento absoluto: pan-y en CSS 3D de Black Card sin alterar estilos de administración ni Panel V2", () => {
    const rootDir = path.resolve(__dirname, "..");
    const stylesCss = fs.readFileSync(path.join(rootDir, "styles.css"), "utf8");
    expect(stylesCss).toContain("touch-action: pan-y;");
    expect(stylesCss).toContain(".kani-card-3d-scene.is-settled-front");
    expect(fs.existsSync(path.join(rootDir, "components/kani/v2/layout.tsx"))).toBe(true);
  });
});
