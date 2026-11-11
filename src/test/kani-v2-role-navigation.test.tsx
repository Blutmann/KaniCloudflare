import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({role:'MANAGER',path:'/panel-administracion/turnos'}));
vi.mock('@tanstack/react-router',()=>({
  Link: ({to,children}:any)=><a href={to}>{children}</a>,
  Outlet: ()=><div data-testid="private-child">Contenido de sección</div>,
  useLocation:()=>state.path,
}));
vi.mock('@/lib/kani-auth',()=>({clearStaffCache:vi.fn(),getAuthenticatedStaff:async()=>({user:{id:'verified'},profile:{role:state.role,active:true,barber_id:state.role==='BARBER'?'barber-1':null},barbers:[]})}));
vi.mock('@/lib/kani-admin-context',()=>({
  AdminStaffProvider:({children}:any)=>children,
  useAdminStaff:()=>({profile:{role:state.role,active:true,barber_id:state.role==='BARBER'?'barber-1':null}}),
}));
vi.mock('@/components/kani/v2/data',()=>({V2DataProvider:({children}:any)=>children,useV2:()=>({loading:false,error:'',refresh:vi.fn()})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{supabaseUrl:'https://iockpxtkflyjfagkvgnr.supabase.co',auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe:vi.fn()}}})}}}));
import { V2Layout } from '@/components/kani/v2/layout';
describe('role navigation and direct URLs',()=>{
  beforeEach(()=>{state.role='MANAGER';state.path='/panel-administracion/turnos';});
  it('shows operational sections and excludes discounts from the top navigation bar',async()=>{
    render(<V2Layout/>); await screen.findByTestId('private-child');
    expect(screen.queryByRole('link',{name:'Descuentos'})).toBeNull();
    expect(screen.queryByRole('link',{name:'Mantenimiento'})).toBeNull();
    expect(screen.getByRole('link',{name:'Turnos'})).toBeInTheDocument();
  });
  it('renders discounts child on direct URL for authorized manager',async()=>{
    state.role='MANAGER';state.path='/panel-administracion/descuentos';render(<V2Layout/>);
    expect(await screen.findByTestId('private-child')).toBeInTheDocument();
    expect(screen.queryByRole('link',{name:'Descuentos'})).toBeNull();
  });
  it('does not render a restricted child on a direct manager maintenance URL',async()=>{
    state.path='/panel-administracion/mantenimiento';render(<V2Layout/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('No tenés permisos');
    expect(screen.queryByTestId('private-child')).toBeNull();
  });
  it('does not render discounts or maintenance for a barber even through a direct URL',async()=>{
    state.role='BARBER';state.path='/panel-administracion/descuentos';render(<V2Layout/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('No tenés permisos');
    expect(screen.queryByRole('link',{name:'Descuentos'})).toBeNull();
    expect(screen.queryByTestId('private-child')).toBeNull();
  });
  it('preserves ADMIN access to maintenance',async()=>{
    state.role='ADMIN';state.path='/panel-administracion/mantenimiento';render(<V2Layout/>);
    expect(await screen.findByTestId('private-child')).toBeInTheDocument();
  });
});
