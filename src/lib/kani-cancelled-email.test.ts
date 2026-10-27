import { expect, it } from 'vitest';
import { buildCancelledEmail } from './kani-notifications.functions';
it('builds the brief cancellation message and configured booking CTA with escaped content',()=>{
  const result=buildCancelledEmail({barberName:'<Lautaro>',bookingDate:'2026-11-02',startTime:'10:45:00'} as any,'https://booking.example/reservar');
  expect(result.text).toContain('Se canceló tu turno con <Lautaro> el día 2 de noviembre a las 10:45 hs.');
  expect(result.html).toContain('&lt;Lautaro&gt;');
  expect(result.html).toContain('href="https://booking.example/reservar"');
  expect(result.html).toContain('Solicitá un nuevo turno');
});
