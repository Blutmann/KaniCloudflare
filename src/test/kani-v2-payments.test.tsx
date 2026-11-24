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
vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({}),
  useLocation: (opts?: { select?: (loc: { pathname: string }) => unknown }) =>
    opts?.select
      ? opts.select({ pathname: "/panel-administracion/pagos" })
      : { pathname: "/panel-administracion/pagos" },
}));
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
    const successMsg = await screen.findByText("Cobro registrado.");
    expect(successMsg).toBeTruthy();
    expect(successMsg).toHaveAttribute("role", "status");
  });
  it("preserves the form and exposes a failure without trying another insert", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN_BARBER_SCOPE" } });
    render(<V2Payments />);
    fireEvent.click(screen.getByRole("button", { name: /Registrar cobro|Cobrar/i }));
    const errorMsg = await screen.findByText(/No se confirmó el cobro/);
    expect(errorMsg).toBeTruthy();
    expect(errorMsg).toHaveAttribute("role", "alert");
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
  it('offers 1-tap service buttons (4 in walk-in, 5 including Anulado in appointment)', () => {
    render(<V2Payments />);
    const walkInGroup = screen.getByRole('group', { name: 'Servicio' });
    const walkInButtons = within(walkInGroup).getAllByRole('button');
    expect(walkInButtons.map((b) => b.querySelector('.v2-quick-chip-name')?.textContent)).toEqual([
      'Corte',
      'Corte y barba',
      'Barba',
      'Otro',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Con turno' }));
    const apptButtons = within(screen.getByRole('group', { name: 'Servicio' })).getAllByRole('button');
    expect(apptButtons.map((b) => b.querySelector('.v2-quick-chip-name')?.textContent)).toEqual([
      'Corte',
      'Corte y barba',
      'Barba',
      'Otro',
      'Anulado',
    ]);
  });
  it('records an eligible zero-value void in appointment mode without a direct insert or a provider claim', async () => {
    mocks.benefit = { depositPaid: false, depositAmountArs: 0 };
    mocks.rpc.mockResolvedValue({ data: { id: 'void' }, error: null });
    render(<V2Payments />);
    fireEvent.click(screen.getByRole('button', { name: 'Con turno' }));
    fireEvent.change(screen.getByLabelText('Turno'), { target: { value: 'a1' } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Servicio' })).getByRole('button', { name: 'Anulado' }));
    const submit = screen.getByRole('button', { name: /Registrar cobro|Cobrar/i });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({ p_service_name: 'Anulado', p_service_price_ars: 0 });
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
    expect(dialog.getByLabelText('Precio ($ ARS)')).toHaveValue(30000);
    expect(dialog.getByLabelText('Descuento ($ ARS)')).toHaveValue(5000);
    expect(dialog.getByLabelText('Importe total')).toHaveValue(25000);
    expect(dialog.getByLabelText('Barbero')).toBeDisabled();
  });

  it('exposes editError with role="alert" when saving an edited payment fails', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
    mocks.payments = [{ id: 'p1', barberId: 'b1', barberName: 'Gonzalo', serviceName: 'Corte', servicePriceArs: 25000, discountArs: 0, finalAmountArs: 25000, collectedAmountArs: 25000, paymentDate: today, paymentTime: '10:00', paymentMethod: 'Efectivo', onlineDepositPaid: false, onlineDepositAmountArs: 0, appointmentId: null }];
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'EDIT_PAYMENT_FAILED' } });
    render(<V2Payments />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Editar cobro' })[0]!);
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.submit(dialog.getByRole('button', { name: /Guardar cambios/i }).closest('form')!);
    const alert = await dialog.findByRole('alert');
    expect(alert).toBeInTheDocument();
  });
});

describe('Benefit-aware appointment collection',()=>{
 beforeEach(()=>{mocks.rpc.mockReset();mocks.refresh.mockReset();mocks.payments=[];mocks.role='BARBER';mocks.depositSupported=true;mocks.benefit=null;});
 it.each([[2500,22500,17500]])('keeps benefit discount %i and the true remaining balance',async(discount,final,balance)=>{
  mocks.benefit={benefitCode:'CONTROL',benefitOriginalPriceArs:25000,benefitDiscountAmountArs:discount,benefitFinalPriceArs:final,depositPaid:final>0,depositAmountArs:final>0?5000:0};
  mocks.rpc.mockResolvedValue({data:{id:'benefit-payment'},error:null});
  render(<V2Payments/>);fireEvent.click(screen.getByRole('button',{name:'Con turno'}));fireEvent.change(screen.getByLabelText('Turno'),{target:{value:'a1'}});
  expect(screen.getByRole('button', { name: 'Cobrar $' + balance.toLocaleString('es-AR') })).toBeInTheDocument();
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

 it('calls refresh({ silent: true }) after registering a payment, shows role="alert" on invalid date range, and uses v2-destructive on Confirmar anulación', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  mocks.role = 'ADMIN';
  mocks.payments = [
    {
      id: 'p1',
      barberId: 'b1',
      barberName: 'Gonzalo',
      serviceName: 'Corte',
      servicePriceArs: 25000,
      discountArs: 0,
      finalAmountArs: 25000,
      collectedAmountArs: 25000,
      paymentDate: today,
      paymentTime: '10:00',
      paymentMethod: 'Efectivo',
      onlineDepositPaid: false,
      onlineDepositAmountArs: 0,
      appointmentId: null,
    },
  ];
  mocks.rpc.mockResolvedValue({ data: { id: 'p2' }, error: null });

  render(<V2Payments />);

  // 1. Registrar cobro -> refresh({ silent: true })
  fireEvent.click(screen.getByRole('button', { name: /Registrar cobro|Cobrar/i }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith({ silent: true }));

  // 2. Modal de anulación -> título, pregunta, ficha resumen y botón Anular pago con v2-destructive action-reject
  fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar cobro' })[0]!);
  const deleteDialog = within(screen.getByRole('dialog'));
  expect(deleteDialog.getByRole('heading', { name: 'Anular pago' })).toBeInTheDocument();
  expect(deleteDialog.getByText('¿Querés anular este cobro?')).toBeInTheDocument();
  expect(deleteDialog.queryByText(/baja lógica con trazabilidad/i)).not.toBeInTheDocument();
  expect(deleteDialog.getByText('Sin cliente asociado')).toBeInTheDocument();
  expect(deleteDialog.getByText(`${today} · 10:00 hs`)).toBeInTheDocument();
  expect(deleteDialog.getByText('Corte')).toBeInTheDocument();
  expect(deleteDialog.getByText('Efectivo')).toBeInTheDocument();
  expect(deleteDialog.getByText('$25.000')).toBeInTheDocument();
  const confirmBtn = deleteDialog.getByRole('button', { name: 'Anular pago' });
  expect(confirmBtn).toHaveClass('v2-destructive', 'action-reject');
  expect(confirmBtn).not.toHaveClass('v2-primary');
  fireEvent.click(deleteDialog.getByRole('button', { name: 'Cancelar' }));

  // 3. Rango inválido en filtro personalizado -> role="alert"
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'CUSTOM' } });
  fireEvent.change(screen.getByLabelText('Fecha desde'), { target: { value: '2026-12-20' } });
  fireEvent.change(screen.getByLabelText('Fecha hasta'), { target: { value: '2026-12-10' } });
  const rangeAlert = screen.getByText(/Rango no válido:/i);
  expect(rangeAlert).toHaveAttribute('role', 'alert');
 });

 it('supports 1-tap Service and Method selection, renders Cash Summary Efectivo vs Transferencia vs Payway, and filters history by method', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  mocks.payments = [
    {
      id: 'p-cash',
      barberId: 'b1',
      barberName: 'Gonzalo',
      serviceName: 'Corte',
      servicePriceArs: 25000,
      discountArs: 0,
      finalAmountArs: 25000,
      collectedAmountArs: 25000,
      paymentDate: today,
      paymentTime: '10:00',
      paymentMethod: 'Efectivo',
      onlineDepositPaid: false,
      onlineDepositAmountArs: 0,
      appointmentId: null,
    },
    {
      id: 'p-transfer',
      barberId: 'b1',
      barberName: 'Gonzalo',
      serviceName: 'Corte y barba',
      servicePriceArs: 30000,
      discountArs: 0,
      finalAmountArs: 30000,
      collectedAmountArs: 30000,
      paymentDate: today,
      paymentTime: '11:00',
      paymentMethod: 'Transferencia',
      onlineDepositPaid: false,
      onlineDepositAmountArs: 0,
      appointmentId: null,
    },
    {
      id: 'p-payway',
      barberId: 'b1',
      barberName: 'Gonzalo',
      serviceName: 'Barba',
      servicePriceArs: 15000,
      discountArs: 0,
      finalAmountArs: 15000,
      collectedAmountArs: 15000,
      paymentDate: today,
      paymentTime: '12:00',
      paymentMethod: 'Tarjeta — Payway',
      onlineDepositPaid: false,
      onlineDepositAmountArs: 0,
      appointmentId: null,
    },
  ];
  mocks.rpc.mockResolvedValue({ data: { id: 'p-new' }, error: null });

  render(<V2Payments />);

  // Resumen de caja arriba (colapsable en móvil con aria-expanded, 3 columnas: Efectivo | Transf. | Payway)
  const cashSummary = screen.getByRole('region', { name: 'Resumen de caja' });
  const cashToggle = within(cashSummary).getByRole('button', { name: /Caja del día/i });
  expect(cashToggle).toHaveAttribute('aria-expanded', 'false');
  const breakdown = cashSummary.querySelector('#v2-cash-summary-breakdown');
  expect(breakdown).not.toHaveClass('is-open');
  fireEvent.click(cashToggle);
  expect(cashToggle).toHaveAttribute('aria-expanded', 'true');
  expect(breakdown).toHaveClass('is-open');
  expect(within(cashSummary).getByText('$70.000')).toBeInTheDocument();
  expect(within(cashSummary).getByText(/3 cobros/)).toBeInTheDocument();
  expect(within(cashSummary).getByText('$25.000')).toBeInTheDocument();
  expect(within(cashSummary).getByText('$30.000')).toBeInTheDocument();
  expect(within(cashSummary).getByText('$15.000')).toBeInTheDocument();

  // Filtro por método en el historial (Todos | Efectivo | Transf. | Payway)
  const methodFilterGroup = screen.getByRole('group', { name: 'Filtrar por método' });
  fireEvent.click(within(methodFilterGroup).getByRole('button', { name: 'Payway' }));
  const historyPanel = screen.getByRole('region', { name: 'Cobros registrados' });
  expect(within(historyPanel).getByText('1 servicios')).toBeInTheDocument();

  // Selección en 1 toque de Servicio y Método de pago (solo Efectivo y Transferencia)
  const serviceGroup = screen.getByRole('group', { name: 'Servicio' });
  const comboBtn = within(serviceGroup).getByRole('button', { name: /Corte y barba/i });
  fireEvent.click(comboBtn);
  expect(comboBtn).toHaveAttribute('aria-pressed', 'true');

  const methodGroup = screen.getByRole('group', { name: 'Método de pago' });
  expect(within(methodGroup).getAllByRole('button').map((b) => b.textContent)).toEqual([
    'Efectivo',
    'Transferencia',
  ]);
  const transferBtn = within(methodGroup).getByRole('button', { name: 'Transferencia' });
  fireEvent.click(transferBtn);
  expect(transferBtn).toHaveAttribute('aria-pressed', 'true');

  const submitBtn = screen.getByRole('button', { name: 'Cobrar $30.000' });
  fireEvent.click(submitBtn);
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
  expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
    p_service_name: 'Corte y barba',
    p_service_price_ars: 30000,
    p_payment_method: 'Transferencia',
  });
 });

 it('deducts Payway deposit ($5.000) in Importe with dot-thousands (20.000), shows Cobrar $20.000, and avoids double deduction on submit', async () => {
  mocks.rpc.mockResolvedValue({ data: { id: 'p-dep-1' }, error: null });
  render(<V2Payments />);

  fireEvent.click(screen.getByRole('button', { name: 'Con turno' }));
  fireEvent.change(screen.getByLabelText('Turno'), { target: { value: 'a1' } });

  const amountInput = screen.getByLabelText('Importe') as HTMLInputElement;
  expect(amountInput.type).toBe('text');
  expect(amountInput.value).toBe('20.000');
  expect(screen.getByText('Servicio $25.000 · Seña Payway -$5.000')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cobrar $20.000' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Cobrar $20.000' }));
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
  expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
    p_appointment_id: 'a1',
    p_service_price_ars: 25000,
    p_discount_value: 0,
    p_final_amount_ars: null,
  });

  // Editing Importe to 18000 formats to 18.000 and sets p_final_amount_ars = 23000 (18000 + 5000 deposit)
  fireEvent.click(screen.getByRole('button', { name: 'Con turno' }));
  fireEvent.change(screen.getByLabelText('Turno'), { target: { value: 'a1' } });
  fireEvent.change(screen.getByLabelText('Importe'), { target: { value: '18000' } });
  expect((screen.getByLabelText('Importe') as HTMLInputElement).value).toBe('18.000');
  expect(screen.getByRole('button', { name: 'Cobrar $18.000' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Cobrar $18.000' }));
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
  expect(mocks.rpc.mock.calls[1]?.[1]).toMatchObject({
    p_appointment_id: 'a1',
    p_service_price_ars: 25000,
    p_final_amount_ars: 23000,
  });
 });

 it('allows switching service on an appointment with deposit from Corte ($25.000) to Corte y barba ($30.000) and collects $25.000', async () => {
  mocks.rpc.mockResolvedValue({ data: { id: 'p-upgrade-1' }, error: null });
  render(<V2Payments />);

  fireEvent.click(screen.getByRole('button', { name: 'Con turno' }));
  fireEvent.change(screen.getByLabelText('Turno'), { target: { value: 'a1' } });

  const serviceGroup = screen.getByRole('group', { name: 'Servicio' });
  fireEvent.click(within(serviceGroup).getByRole('button', { name: /Corte y barba/i }));

  expect((screen.getByLabelText('Importe') as HTMLInputElement).value).toBe('25.000');
  const submitBtn = screen.getByRole('button', { name: 'Cobrar $25.000' });
  expect(submitBtn).not.toBeDisabled();

  fireEvent.click(submitBtn);
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
  expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
    p_appointment_id: 'a1',
    p_service_name: 'Corte y barba',
    p_service_price_ars: 30000,
    p_final_amount_ars: null,
  });

  // Switching to Otro and editing Importe to 70.000 updates breakdown to Servicio $75.000 · Seña Payway -$5.000
  fireEvent.click(screen.getByRole('button', { name: 'Con turno' }));
  fireEvent.change(screen.getByLabelText('Turno'), { target: { value: 'a1' } });
  fireEvent.click(within(screen.getByRole('group', { name: 'Servicio' })).getByRole('button', { name: 'Otro' }));
  fireEvent.change(screen.getByLabelText('Importe'), { target: { value: '70000' } });
  expect((screen.getByLabelText('Importe') as HTMLInputElement).value).toBe('70.000');
  expect(screen.getByText('Servicio $75.000 · Seña Payway -$5.000')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cobrar $70.000' })).not.toBeDisabled();
 });
});
