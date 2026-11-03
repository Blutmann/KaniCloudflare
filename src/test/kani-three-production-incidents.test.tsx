import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validatePaywayDraft } from "@/lib/kani-payway";
import { createPaywayStore } from "@/lib/kani-payway-store.server";

const v2Mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  fromInsertSingle: vi.fn(),
  fromUpdateEq: vi.fn(),
  refresh: vi.fn(),
  role: "ADMIN",
  depositSupported: true,
}));

const dbServerMocks = vi.hoisted(() => ({
  createPaymentSupabaseClient: vi.fn(),
  createRequestSupabaseClient: vi.fn(),
  getRequestAuthToken: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useSearch: () => ({}) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: v2Mocks.rpc,
    from: (table: string) => {
      if (table === "service_payments") {
        return {
          insert: (payload: unknown) => ({
            select: () => ({
              single: () => v2Mocks.fromInsertSingle(payload),
            }),
          }),
        };
      }
      if (table === "appointments") {
        return {
          update: (payload: unknown) => ({
            eq: (col: string, val: string) => v2Mocks.fromUpdateEq(payload, col, val),
          }),
        };
      }
      return {};
    },
  },
}));
vi.mock("@/lib/kani-payment-db.server", () => ({
  createPaymentSupabaseClient: dbServerMocks.createPaymentSupabaseClient,
}));
vi.mock("@/lib/kani-notifications.server", () => ({
  createRequestSupabaseClient: dbServerMocks.createRequestSupabaseClient,
  getRequestAuthToken: dbServerMocks.getRequestAuthToken,
  dispatchAppointmentNotification: vi.fn(),
}));
vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    user: { id: "admin-uid-1" },
    profile: { role: v2Mocks.role, barber_id: "b1", display_name: "Admin" },
    barbers: [
      { id: "b1", name: "Gonzalo" },
      { id: "b2", name: "Lucas" },
    ],
  }),
}));
vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => ({
    appointments: [],
    payments: [],
    services: [
      { id: "corte", name: "Corte de cabello", price: 25000 },
      { id: "barba", name: "Barba", price: 15000 },
    ],
    clients: [],
    barberId: "ALL",
    setBarberId: vi.fn(),
    refresh: v2Mocks.refresh,
    loading: false,
    depositSupported: v2Mocks.depositSupported,
  }),
}));

import { V2Payments } from "@/components/kani/v2/payments";
import {
  adminToggleBenefitCodeStatus,
  adminDeleteBenefitCode,
} from "@/lib/kani-benefit-codes.server";

describe("Tres incidentes productivos — Regresión integral", () => {
  beforeEach(() => {
    v2Mocks.rpc.mockReset();
    v2Mocks.fromInsertSingle.mockReset();
    v2Mocks.fromUpdateEq.mockReset();
    v2Mocks.refresh.mockReset();
    dbServerMocks.createPaymentSupabaseClient.mockReset();
    dbServerMocks.createRequestSupabaseClient.mockReset();
    dbServerMocks.getRequestAuthToken.mockReset();
  });

  describe("1. Reserva: Payway draft con benefitQuote y fallback Corte <-> Corte de cabello", () => {
    it("acepta un BookingPaymentDraft con benefitQuote undefined o poblado y devuelve un PaywayDraft limpio", () => {
      const draftWithUndefinedQuote = {
        barber: "Lautaro",
        serviceId: "corte",
        serviceName: "Corte",
        servicePriceArs: 25000,
        durationMin: 45,
        date: "2026-11-10",
        time: "14:00",
        name: "Juan Pérez",
        email: "juan@example.com",
        phone: "+5491122334455",
        notes: "",
        benefitCode: undefined,
        benefitQuote: undefined,
      };

      const cleaned = validatePaywayDraft(draftWithUndefinedQuote);
      expect(cleaned.serviceName).toBe("Corte");
      expect("benefitQuote" in cleaned).toBe(false);

      const draftWithPopulatedQuote = {
        ...draftWithUndefinedQuote,
        benefitCode: "KANI-DESC-1000-ABCD",
        benefitQuote: {
          valid: true,
          code: "KANI-DESC-1000-ABCD",
          originalServicePriceArs: 25000,
          discountAmountArs: 5000,
          finalServicePriceArs: 20000,
          onlineDepositArs: 5000,
          inPersonBalanceArs: 15000,
          requiresOnlinePayment: true,
        },
      };

      const cleanedWithCode = validatePaywayDraft(draftWithPopulatedQuote);
      expect(cleanedWithCode.benefitCode).toBe("KANI-DESC-1000-ABCD");
      expect("benefitQuote" in cleanedWithCode).toBe(false);
    });

    it("reintenta prepare_payway_attempt con 'Corte de cabello' cuando 'Corte' devuelve BARBER_OR_SERVICE_NOT_FOUND", async () => {
      const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
      const mockDb = {
        rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
          rpcCalls.push({ fn, args });
          if (fn === "prepare_payway_attempt" && args.p_service_name === "Corte") {
            return {
              data: null,
              error: { code: "P0001", message: "BARBER_OR_SERVICE_NOT_FOUND" },
            };
          }
          if (fn === "prepare_payway_attempt" && args.p_service_name === "Corte de cabello") {
            return {
              data: {
                id: "01234567-89ab-cdef-0123-456789abcdef",
                appointment_id: "apt-456",
                request_number: "KANI-1001",
                site_transaction_id: "KANI0123456789abcdef0123456789abcdef",
                amount_ars: 5000,
                amount_minor_units: 500000,
                expires_at: new Date(Date.now() + 600_000).toISOString(),
              },
              error: null,
            };
          }
          return { data: null, error: null };
        }),
        from: vi.fn(),
      };

      const store = createPaywayStore(mockDb as never, "40406512", {
        read: async () => null,
        write: async () => {},
      });

      const prepared = await store.prepare({
        barber: "Lautaro",
        serviceName: "Corte",
        date: "2026-11-10",
        time: "14:00",
        name: "Juan Pérez",
        email: "juan@example.com",
        phone: "+5491122334455",
        notes: "",
      });

      expect(prepared.attemptId).toBe("0123456789abcdef0123456789abcdef");
      expect(prepared.appointmentId).toBe("apt-456");
      expect(rpcCalls.map((c) => c.args.p_service_name)).toEqual(["Corte", "Corte de cabello"]);
    });
  });

  describe("2. Pagos administrativos: servicio «Otro» con descripción personalizada", () => {
    it("valida descripción obligatoria en «Otro» y envía clasificación «Otros» con detalle en service_other_detail", async () => {
      v2Mocks.rpc.mockResolvedValue({ data: [{ payment_id: "pay-otro-1" }], error: null });

      render(<V2Payments />);
      fireEvent.change(screen.getByLabelText("Servicio"), { target: { value: "Otro" } });

      const descInput = screen.getByLabelText("Detalle del servicio");
      const priceInput = screen.getByLabelText(/Importe \(\$ ARS\)/i);
      fireEvent.change(priceInput, { target: { value: "18000" } });
      fireEvent.change(descInput, { target: { value: "A" } });

      // Con descripción de 1 carácter no debe llamar a la base de datos
      fireEvent.click(screen.getByRole("button", { name: /Registrar cobro|Cobrar/i }));
      expect(await screen.findByText(/Ingresá el nombre del servicio personalizado/i)).toBeTruthy();
      expect(v2Mocks.rpc).not.toHaveBeenCalled();

      // Con descripción personalizada e importe válido
      fireEvent.change(descInput, { target: { value: "Perfilado" } });

      fireEvent.click(screen.getByRole("button", { name: /Registrar cobro|Cobrar/i }));
      await waitFor(() => expect(v2Mocks.rpc).toHaveBeenCalledTimes(1));

      expect(v2Mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
        p_barber_id: "b1",
        p_service_name: "Otros",
        p_service_other_detail: "Perfilado",
        p_service_price_ars: 18000,
      });
      expect(await screen.findByText("Cobro registrado.")).toBeTruthy();
    });

    it("ejecuta fallback directo en service_payments con service_name = 'Otros' si la RPC viola service_payments_service_name_check", async () => {
      v2Mocks.rpc.mockResolvedValue({
        data: null,
        error: {
          message:
            'new row for relation "service_payments" violates check constraint "service_payments_service_name_check"',
        },
      });
      v2Mocks.fromInsertSingle.mockResolvedValue({
        data: { id: "pay-fallback-otro-1" },
        error: null,
      });

      render(<V2Payments />);
      fireEvent.change(screen.getByLabelText("Servicio"), { target: { value: "Otro" } });
      fireEvent.change(screen.getByLabelText("Detalle del servicio"), {
        target: { value: "Perfilado" },
      });
      fireEvent.change(screen.getByLabelText(/Importe \(\$ ARS\)/i), {
        target: { value: "18000" },
      });

      fireEvent.click(screen.getByRole("button", { name: /Registrar cobro|Cobrar/i }));

      await waitFor(() => expect(v2Mocks.fromInsertSingle).toHaveBeenCalledTimes(1));
      expect(v2Mocks.fromInsertSingle.mock.calls[0]?.[0]).toMatchObject({
        barber_id: "b1",
        service_name: "Otros",
        service_other_detail: "Perfilado",
        service_price_ars: 18000,
        discount_ars: 0,
        final_amount_ars: 18000,
        collected_amount_ars: 18000,
        service_origin: "walk_in",
      });
      expect(await screen.findByText("Cobro registrado.")).toBeTruthy();
      expect(v2Mocks.refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("3. Descuentos: activar, desactivar y eliminar códigos con fallback de esquema y protección de consumidos", () => {
    it("activa un código DISABLED (KANI-MEMBRESIA-LAUT1) mediante fallback servidor cuando admin_toggle_benefit_code_status no está en schema cache y bloquea reactivar un código SINGLE_USE consumido", async () => {
      const updatedPayloads: Array<{ id: string; payload: Record<string, unknown> }> = [];
      let currentCodeRow: Record<string, unknown> = {
        id: "216218fe-d0e1-483c-ac97-1edd14b4d195",
        code: "KANI-MEMBRESIA-LAUT1",
        type: "MEMBERSHIP",
        status: "DISABLED",
        internal_note: "Membresía Lautaro",
        consumed_at: null,
        consumed_appointment_id: null,
      };

      dbServerMocks.createRequestSupabaseClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "admin-1", email: "admin@kanibarber.com" } },
            error: null,
          }),
        },
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: {
            message:
              "Could not find the function public.admin_toggle_benefit_code_status(p_active, p_code_id) in the schema cache",
          },
        }),
        from: (table: string) => {
          if (table === "staff_profiles") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { role: "ADMIN", active: true, display_name: "Admin Kani" },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        },
      });

      dbServerMocks.createPaymentSupabaseClient.mockResolvedValue({
        from: (table: string) => {
          if (table === "benefit_codes") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: currentCodeRow, error: null }),
                }),
              }),
              update: (payload: Record<string, unknown>) => ({
                eq: async (_col: string, id: string) => {
                  updatedPayloads.push({ id, payload });
                  currentCodeRow = { ...currentCodeRow, ...payload };
                  return { error: null };
                },
              }),
            };
          }
          return {};
        },
      });

      const res = await adminToggleBenefitCodeStatus({
        token: "valid-admin-jwt",
        codeId: "216218fe-d0e1-483c-ac97-1edd14b4d195",
        active: true,
      });

      expect(res).toBe(true);
      expect(updatedPayloads).toHaveLength(1);
      expect(updatedPayloads[0]?.payload).toMatchObject({ status: "ACTIVE" });

      // Ahora simular un código de un solo uso ya CONSUMED: debe rechazar su reactivación
      currentCodeRow = {
        id: "consumed-single-use-1",
        code: "KANI-MEMBRESIA-USED1",
        type: "MEMBERSHIP",
        status: "CONSUMED",
        internal_note: "Consumido",
        consumed_at: "2026-11-01T15:00:00Z",
        consumed_appointment_id: "apt-999",
      };

      await expect(
        adminToggleBenefitCodeStatus({
          token: "valid-admin-jwt",
          codeId: "consumed-single-use-1",
          active: true,
        }),
      ).rejects.toThrow(/No se puede reactivar un código de un solo uso que ya fue consumido/i);

      // Baja lógica (eliminar) preservando historial
      currentCodeRow = {
        id: "216218fe-d0e1-483c-ac97-1edd14b4d195",
        code: "KANI-MEMBRESIA-LAUT1",
        type: "MEMBERSHIP",
        status: "ACTIVE",
        internal_note: "Membresía Lautaro",
        consumed_at: null,
        consumed_appointment_id: null,
      };

      const delRes = await adminDeleteBenefitCode(
        "216218fe-d0e1-483c-ac97-1edd14b4d195",
        "valid-admin-jwt",
      );
      expect(delRes).toBe(true);
      expect(String(currentCodeRow.internal_note)).toContain("[[KANI_META:");
      expect(String(currentCodeRow.internal_note)).toContain("deletedAt");
    });
  });
});
