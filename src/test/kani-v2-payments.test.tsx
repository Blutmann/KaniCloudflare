import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  refresh: vi.fn(),
  role: "BARBER",
  depositSupported: true,
  payments: [] as any[],
  benefit: null as any,
}));
vi.mock("@tanstack/react-router", () => ({ useSearch: () => ({}) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    profile: { role: mocks.role, barber_id: "b1" },
    barbers: [{ id: "b1", name: "Gonzalo" }],
  }),
}));
vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => ({
    appointments: [
      {
        id: "a1",
        name: "Juan",
        serviceName: "Corte",
        servicePrice: 25000,
        barberId: "b1",
        barber: "Gonzalo",
        statusCode: "CONFIRMED",
        date: "2026-10-21",
        time: "10:00",
        depositPaid: true,
        depositAmountArs: 5000,
        ...mocks.benefit,
      },
    ],
    payments: mocks.payments,
    services: [{ id: "corte", name: "Corte de cabello", price: 25000 }, { id: 'combinado', name: 'Corte + barba', price: 30000 }],
    clients: [],
    barberId: "ALL",
    setBarberId: vi.fn(),
    refresh: mocks.refresh,
    loading: false,
    depositSupported: mocks.depositSupported,
  }),
}));
import { V2Payments } from "@/components/kani/v2/payments";

describe("V2 quick collection", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.refresh.mockReset();
    mocks.role = "BARBER";
    mocks.depositSupported = true;
    mocks.payments = [];
    mocks.benefit = null;
  });
  it("registers an anonymous walk-in using the authenticated barber and server clock", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "p1" }, error: null });
    render(<V2Payments />);
    fireEvent.click(screen.getByRole("button", { name: /Registrar cobro|Cobrar/i }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_barber_id: "b1",
      p_service_price_ars: 25000,
      p_appointment_id: null,
      p_discount_kind: "FIXED",
      p_discount_value: 0,
    });
    expect(mocks.rpc.mock.calls[0]?.[0]).toBe("staff_save_service_payment");
    expect(mocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_online_deposit_paid");
    expect(mocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_payment_date");
    expect(await screen.findByText("Cobro registrado.")).toBeTruthy();
  });
  it("preserves the form and exposes a failure without trying another insert", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN_BARBER_SCOPE" } });
    render(<V2Payments />);
    fireEvent.click(screen.getByRole("button", { name: /Registrar cobro|Cobrar/i }));
    expect(await screen.findByText(/No se confirmó el cobro/)).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("does not permit collecting an appointment with unverifiable deposit information", () => {
    mocks.depositSupported = false;
    render(<V2Payments />);
    fireEvent.click(screen.getByRole("button", { name: "Con turno" }));
    fireEvent.change(screen.getByLabelText("Turno"), { target: { value: "a1" } });
    expect(screen.getByRole("button", { name: /Registrar cobro|Cobrar/i })).toBeDisabled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('offers exactly the five payment classifications', () => {
    render(<V2Payments/>);
    const options=within(screen.getByLabelText('Servicio')).getAllByRole('option');
    expect(options.map(option=>option.textContent)).toEqual(['Corte','Corte y barba','Barba','Otro','Anulado']);
  });
  it('records an eligible zero-value void without a direct insert or a provider claim', async () => {
    mocks.rpc.mockResolvedValue({data:{id:'void'},error:null});
    render(<V2Payments/>);
    fireEvent.change(screen.getByLabelText('Servicio'),{target:{value:'Anulado'}});
    const submit=screen.getByRole('button',{name:/Registrar cobro|Cobrar/i});
    expect(submit).toBeEnabled(); fireEvent.click(submit);
    await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({p_service_name:'Anulado',p_service_price_ars:0});
    expect(mocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty('p_online_deposit_paid');
  });
  it('allows a barber to edit an own payment and retain its fixed discount on service change', () => {
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}).format(new Date());
    mocks.payments=[{id:'p1',barberId:'b1',barberName:'Gonzalo',serviceName:'Corte',servicePriceArs:25000,discountArs:5000,finalAmountArs:20000,collectedAmountArs:20000,paymentDate:today,paymentTime:'10:00',paymentMethod:'Efectivo',onlineDepositPaid:false,onlineDepositAmountArs:0,appointmentId:null}];
    render(<V2Payments/>);
    expect(screen.queryByRole('button',{name:'Eliminar cobro'})).toBeNull();
    fireEvent.click(screen.getAllByRole('button',{name:'Editar cobro'})[0]!);
    const dialog=within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Servicio'),{target:{value:'Corte y barba'}});
    expect(dialog.getByLabelText('Precio servicio ($ ARS)')).toHaveValue(30000);
    expect(dialog.getByLabelText('Descuento ($ ARS)')).toHaveValue(5000);
    expect(dialog.getByLabelText('Importe total')).toHaveValue(25000);
    expect(dialog.getByLabelText('Barbero')).toBeDisabled();
  });
});

describe('Benefit-aware appointment collection',()=>{
 beforeEach(()=>{mocks.rpc.mockReset();mocks.refresh.mockReset();mocks.payments=[];mocks.role='BARBER';mocks.depositSupported=true;});
 it.each([[2500,22500,17500]])('keeps benefit discount %i and the true remaining balance',async(discount,final,balance)=>{
  mocks.benefit={benefitCode:'CONTROL',benefitOriginalPriceArs:25000,benefitDiscountAmountArs:discount,benefitFinalPriceArs:final,depositPaid:final>0,depositAmountArs:final>0?5000:0};
  mocks.rpc.mockResolvedValue({data:{id:'benefit-payment'},error:null});
  render(<V2Payments/>);fireEvent.click(screen.getByRole('button',{name:'Con turno'}));fireEvent.change(screen.getByLabelText('Turno'),{target:{value:'a1'}});
  expect(screen.getByText('$'+balance.toLocaleString('es-AR'),{selector:'.v2-total-box-amount'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:/Registrar cobro|Cobrar/i}));await waitFor(()=>expect(mocks.rpc).toHaveBeenCalled());
  expect(mocks.rpc.mock.calls.at(-1)[1]).toMatchObject({p_appointment_id:'a1',p_service_price_ars:25000,p_discount_value:discount});
 });
 it('offers a future appointment and uses the server clock for its receipt',async()=>{
  mocks.benefit={date:'2097-01-10'};mocks.rpc.mockResolvedValue({data:{id:'advance'},error:null});
  render(<V2Payments/>);fireEvent.click(screen.getByRole('button',{name:'Con turno'}));fireEvent.change(screen.getByLabelText('Turno'),{target:{value:'a1'}});
  fireEvent.click(screen.getByRole('button',{name:/Registrar cobro|Cobrar/i}));await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledTimes(1));
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({p_appointment_id:'a1'});expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_payment_date');
 });
 it('does not record a fictitious zero receipt for a free service',()=>{
  mocks.benefit={benefitCode:'FREE',benefitOriginalPriceArs:25000,benefitDiscountAmountArs:25000,benefitFinalPriceArs:0,depositPaid:false,depositAmountArs:0};
  render(<V2Payments/>);fireEvent.click(screen.getByRole('button',{name:'Con turno'}));fireEvent.change(screen.getByLabelText('Turno'),{target:{value:'a1'}});
  expect(screen.getByRole('button',{name:/Registrar cobro|Cobrar/i})).toBeDisabled();expect(screen.getByText('Sin saldo pendiente.')).toBeInTheDocument();expect(mocks.rpc).not.toHaveBeenCalled();
 });

});
