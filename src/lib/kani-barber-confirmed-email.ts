import { buildTurnoIcsUrl } from './kani-calendar-ics';
import { confirmationEmailFonts, confirmationEmailLogo } from './kani-confirmation-email-brand';
import { KANI_STUDIO_FULL_ADDRESS } from './kani-constants';
import { formatServiceNameForEmail } from './kani-model';
import { formatPhoneWithCountryAndWhatsApp, getWhatsAppUrl } from './kani-phone';

export type BarberConfirmationPayload = {
  appointmentId: string;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  barberName: string;
  serviceName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  serviceDurationMinutes: number;
  finalPriceArs: number;
  depositPaidArs: number;
  collectedArs: number;
  benefitCode: string | null;
  benefitType: string | null;
};
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!);
const money = (amount: number) => '$' + amount.toLocaleString('es-AR');

export function buildBarberConfirmedEmail(payload: BarberConfirmationPayload, options: {
  appUrl?: string; calendarSyncEnabled?: boolean; isTest?: boolean;
} = {}) {
  const appUrl = (options.appUrl || 'https://www.kanibarber.com').replace(/\/$/, '');
  const date = new Intl.DateTimeFormat('es-AR', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'America/Argentina/Buenos_Aires' })
    .format(new Date(`${payload.bookingDate}T12:00:00-03:00`));
  const service = formatServiceNameForEmail(payload.serviceName);
  const balance = Math.max(0, payload.finalPriceArs - payload.depositPaidArs - payload.collectedArs);
  const whatsapp = getWhatsAppUrl(payload.clientPhone);
  const phone = whatsapp ? formatPhoneWithCountryAndWhatsApp('+' + whatsapp.split('/').pop()).display : payload.clientPhone;
  const calendarUrl = buildTurnoIcsUrl({ id:payload.appointmentId, bookingDate:payload.bookingDate,
    startTime:payload.startTime, endTime:payload.endTime, serviceDurationMinutes:payload.serviceDurationMinutes,
    serviceName:payload.serviceName, barberName:payload.barberName }, appUrl);
  const benefits: Record<string,string> = { NO_DEPOSIT:'Reserva sin seña', FREE_SERVICE:'Servicio bonificado al 100 %', PERCENT_10:'Descuento del 10 %', PERCENT_50:'Descuento del 50 %' };
  const benefit = payload.benefitCode ? `${benefits[payload.benefitType || ''] || 'Beneficio aplicado'} (${payload.benefitCode})` : null;
  const subject = `${options.isTest ? '[PRUEBA] ' : ''}[KANI] ${payload.clientName.trim().replace(/[\r\n]/g,' ')} agendó un turno con vos`;
  const calendarNote = options.calendarSyncEnabled
    ? 'Kani sincroniza este turno con el calendario central del barbero. Este archivo es opcional para otro calendario; importarlo puede crear duplicados según la aplicación.'
    : 'El archivo es opcional para tu calendario. Importarlo más de una vez puede crear duplicados según la aplicación.';
  const summary: [string,string][] = [
    ['Fecha y hora',`${date} · ${payload.startTime.slice(0,5)} hs`], ['Servicio',service], ['Barbero',payload.barberName],
    ['Precio final',money(payload.finalPriceArs)], ['Seña abonada',money(payload.depositPaidArs)],
    ...(payload.collectedArs>0 ? [['Cobrado en el local',money(payload.collectedArs)] as [string,string]] : []),
    ['Saldo pendiente a pagar en el local',money(balance)], ...(benefit ? [['Beneficio aplicado',benefit] as [string,string]] : []),
  ];
  const contacts: [string,string][] = [['Nombre',payload.clientName], ['Celular',phone || 'No registrado'],
    ...(payload.clientEmail ? [['Email',payload.clientEmail] as [string,string]] : [])];
  const rows = (values: [string,string][]) => values.map(([label,value]) => `<tr><td style="padding: 0 0 16px; overflow-wrap: anywhere;"><div style="color: #C7C7C7; font-size: 12px; font-weight: 600; margin-bottom: 4px;">${escape(label)}</div><div style="color: ${label==='Seña abonada' ? '#E06D80' : '#F5F5F5'}; font-size: 16px; font-weight: 500;">${escape(value)}</div></td></tr>`).join('');
  const button = (url: string,label: string,color: string,text: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 12px;"><tr><td align="center" bgcolor="${color}" style="border-radius: 8px; background-color: ${color};"><a href="${escape(url)}" target="_blank" rel="noopener noreferrer" style="display: block; padding: 14px; min-height: 44px; box-sizing: border-box; font-size: 14px; font-weight: 600; color: ${text}; text-decoration: none; text-align: center;">${label}</a></td></tr></table>`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark only"><meta name="supported-color-schemes" content="dark only"><title>${escape(subject)}</title><link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}@media(max-width:599px){.outer{padding:0!important}.content{padding:24px 20px!important}.container{border-radius:0!important;width:100%!important}.heading{font-size:28px!important}}</style></head>
<body style="margin: 0; padding: 0; background-color: #000000; color: #F5F5F5; font-family: ${confirmationEmailFonts.body}; line-height: 1.5;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escape(`${date} · ${payload.startTime.slice(0,5)} hs · ${service}`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000"><tr><td class="outer" align="center" style="padding:24px 12px 48px;">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" class="container" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background-color:#000000;border:1px solid #383838;border-radius:16px;table-layout:fixed;">
<tr><td align="center" bgcolor="#000000" style="padding:32px 24px 24px;border-bottom:1px solid #383838;">${confirmationEmailLogo(`${appUrl}/kani-email-logo.png`)}</td></tr>
<tr><td class="content" style="padding:28px 48px;">
${options.isTest ? '<p style="color:#B99A5B;font-weight:600;">Prueba controlada · no corresponde a una reserva real.</p>' : ''}
<h1 class="heading" style="font-family:${confirmationEmailFonts.title};font-size:34px;font-weight:400;line-height:1.15;margin:0 0 16px;">Tenés un nuevo turno</h1>
<p style="color:#C7C7C7;margin:0 0 24px;">${escape(payload.clientName)} agendó un turno con vos.</p>
<h2 style="font-family:${confirmationEmailFonts.title};font-size:24px;font-weight:400;color:#B99A5B;margin:0 0 18px;">Resumen del turno</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows(summary)}</table>
<h2 style="font-family:${confirmationEmailFonts.title};font-size:24px;font-weight:400;color:#B99A5B;margin:16px 0 18px;">Datos del cliente</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows(contacts)}</table>
${whatsapp ? button(whatsapp,'Enviar WhatsApp','#762936','#FFFFFF') : ''}
${button(calendarUrl,'Agregar al calendario','#B99A5B','#000000')}
<p style="font-size:12px;color:#C7C7C7;margin:16px 0 0;">${escape(calendarNote)}</p>
</td></tr><tr><td align="center" style="padding:24px;border-top:1px solid #383838;font-size:12px;color:#C7C7C7;">Kani Barber Studio · ${escape(KANI_STUDIO_FULL_ADDRESS)}</td></tr></table>
<!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
  const text = `${options.isTest ? 'PRUEBA CONTROLADA · No corresponde a una reserva real.\n\n' : ''}${payload.clientName} agendó un turno con vos.\n\nRESUMEN DEL TURNO\n${summary.map(([k,v])=>`${k}: ${v}`).join('\n')}\n\nDATOS DEL CLIENTE\n${contacts.map(([k,v])=>`${k}: ${v}`).join('\n')}\n\n${whatsapp ? `Enviar WhatsApp:\n${whatsapp}\n\n` : ''}Agregar al calendario:\n${calendarUrl}\n\n${calendarNote}\n\nKani Barber Studio · ${KANI_STUDIO_FULL_ADDRESS}`;
  return { subject, html, text, diagnostic:whatsapp ? null : 'CLIENT_PHONE_INVALID_OR_MISSING' };
}
