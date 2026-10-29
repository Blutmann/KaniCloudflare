import { getCookie, setCookie } from '@tanstack/react-start/server';

export type PaywaySession = { appointmentId: string; accessToken: string; expiresAt: number };
const cookieName = '__Host-kani-payway-checkout';
const bytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function key(secret: string) {
  if (secret.length<32) throw new Error('PAYWAY_SESSION_CONFIGURATION_MISSING');
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw',hash,'AES-GCM',false,['encrypt','decrypt']);
}
export async function sealPaywaySession(session: PaywaySession, secret: string) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(cookieName)},await key(secret),new TextEncoder().encode(JSON.stringify(session)));
  return `${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}
export async function openPaywaySession(value: string | undefined, secret: string): Promise<PaywaySession | null> {
  if (!value || value.length>1500) return null;
  try {
    const [iv,ciphertext]=value.split('.'); if(!iv||!ciphertext)return null;
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:new TextEncoder().encode(cookieName)},await key(secret),bytes(ciphertext));
    const data=JSON.parse(new TextDecoder().decode(plaintext)) as PaywaySession;
    return /^[a-f0-9-]{36}$/i.test(data.appointmentId)&&/^[A-Za-z0-9_-]{32,128}$/.test(data.accessToken)&&Number.isSafeInteger(data.expiresAt)&&data.expiresAt>Date.now()?data:null;
  } catch { return null; }
}
export function paywaySessionAccess(secret: string) {
  return {
    read: () => openPaywaySession(getCookie(cookieName),secret),
    write: async (session: PaywaySession) => setCookie(cookieName,await sealPaywaySession(session,secret),{
      httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:Math.max(1,Math.floor((session.expiresAt-Date.now())/1000)),
    }),
    clear: () => setCookie(cookieName,'',{
      httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:0,
    }),
  };
}
