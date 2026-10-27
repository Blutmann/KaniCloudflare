import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { businessDateToday } from '@/lib/kani-mobile-appointments';
const mocks=vi.hoisted(()=>({cancel:vi.fn(),status:'PENDING',phone:'+54 9 11 2843-6014'}));
vi.mock('@/lib/kani-admin-context',()=>({useAdminStaff:()=>({barbers:[],profile:{role:'ADMIN',barber_id:null}})}));
vi.mock('./data',()=>({useV2:()=>({barberId:'ALL',setBarberId:vi.fn(),barbers:[],depositSupported:true,refresh:vi.fn(),appointments:[{
  id:'a',barberId:'b',date:businessDateToday(),statusCode:mocks.status,time:'10:00',name:'Cliente',phone:mocks.phone,serviceName:'Corte',barber:'Lautaro'
}]})}));
vi.mock('@/lib/kani-appointments',()=>({updateRealAppointmentStatus:(...args:unknown[])=>mocks.cancel(...args),appointmentErrorMessage:String}));
vi.mock('@tanstack/react-router',()=>({Link:({children}:any)=><a>{children}</a>}));
import { V2Appointments } from './agenda';
afterEach(()=>{cleanup();mocks.status='PENDING';mocks.phone='+54 9 11 2843-6014';});
describe('payment based appointment actions',()=>{
 it('shows cancellation with confirmation and WhatsApp, without manual approval actions',()=>{
  render(<V2Appointments/>);
  expect(screen.queryByRole('button',{name:'Confirmar'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Rechazar'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Enviar correo'})).toBeNull();
  expect(screen.getByRole('link',{name:'Enviar WhatsApp'})).toHaveAttribute('href','https://wa.me/5491128436014');
  fireEvent.click(screen.getByRole('button',{name:'Cancelar turno'}));
  expect(screen.getByRole('heading',{name:'¿Cancelar este turno?'})).toBeInTheDocument();
  expect(mocks.cancel).not.toHaveBeenCalled();
 });
 it('does not offer cancellation for terminal states or links for missing phones',()=>{
  mocks.status='CANCELLED';mocks.phone='';render(<V2Appointments/>);
  expect(screen.queryByRole('button',{name:'Cancelar turno'})).toBeNull();
  expect(screen.getByRole('button',{name:'Enviar WhatsApp'})).toBeDisabled();
 });
});
