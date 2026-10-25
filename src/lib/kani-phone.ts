import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export type PhoneCountry = CountryCode;
export type PhoneCountryOption = {
  code: CountryCode;
  dialCode: string;
  name: string;
  displayName: string;
  flag: string;
  isoCode: CountryCode;
  shortCode: string;
};

export const countryShortDisplayNames: Partial<Record<CountryCode, string>> = {
  AG: 'Antigua',
  BA: 'Bosnia',
  CD: 'RDC Congo',
  CF: 'Centroáfrica',
  DO: 'R. Dominicana',
  AE: 'Emiratos Árabes',
  KN: 'San Cristóbal',
  ST: 'Santo Tomé',
  TT: 'Trinidad',
  VC: 'San Vicente',
  VG: 'Vírgenes (RU)',
  VI: 'Vírgenes (EEUU)',
  IO: 'Océano Índico',
  MP: 'Marianas Norte',
  TC: 'Turcas y Caicos',
  PM: 'San Pedro',
  SJ: 'Svalbard',
  MK: 'Macedonia',
  VA: 'Vaticano',
  MM: 'Myanmar',
  PF: 'Polinesia Fr.',
  PG: 'Papúa N. Guinea',
  GQ: 'Guinea Ecuat.',
  GF: 'Guayana Fr.',
  AS: 'Samoa Americana',
  NC: 'Nueva Caledonia',
  WF: 'Wallis y Futuna',
  PS: 'Palestina',
  HK: 'Hong Kong',
  MO: 'Macao',
  BQ: 'Caribe Neerl.',
  CX: 'Isla de Navidad',
  CC: 'Islas Cocos',
  FK: 'Islas Malvinas',
  MH: 'Islas Marshall',
  SB: 'Islas Salomón',
  BL: 'San Bartolomé',
  MF: 'San Martín',
  SX: 'Sint Maarten',
};

export function countryDisplayName(country?: PhoneCountryOption | null): string {
  if (!country) return '';
  return country.displayName || countryShortDisplayNames[country.code] || country.name;
}

const countryShortCodes: Record<string, string> = { AR: 'ARG', US: 'USA', BR: 'BRA', UY: 'URY', CL: 'CHL', PY: 'PRY', BO: 'BOL', VE: 'VEN', PE: 'PER', CO: 'COL', EC: 'ECU', MX: 'MEX', ES: 'ESP', IT: 'ITA' };
const primaryCountryCodes: PhoneCountry[] = ['AR', 'CL', 'BR', 'UY', 'PY', 'VE', 'PE', 'CO', 'EC', 'MX', 'ES', 'US'];

const mobileExampleNumbers: Record<string, string> = {
  AC: '40123',
  AD: '312345',
  AE: '501234567',
  AF: '701234567',
  AG: '2684641234',
  AI: '2642351234',
  AL: '672123456',
  AM: '77123456',
  AO: '923123456',
  AR: '1123456789',
  AS: '6847331234',
  AT: '664123456',
  AU: '412345678',
  AW: '5601234',
  AX: '412345678',
  AZ: '401234567',
  BA: '61123456',
  BB: '2462501234',
  BD: '1812345678',
  BE: '450001234',
  BF: '70123456',
  BG: '43012345',
  BH: '36001234',
  BI: '79561234',
  BJ: '0195123456',
  BL: '690001234',
  BM: '4413701234',
  BN: '7123456',
  BO: '71234567',
  BQ: '3181234',
  BR: '11961234567',
  BS: '2423591234',
  BT: '17123456',
  BW: '71123456',
  BY: '294911911',
  BZ: '6221234',
  CA: '5062345678',
  CC: '412345678',
  CD: '991234567',
  CF: '70012345',
  CG: '061234567',
  CH: '781234567',
  CI: '0123456789',
  CK: '71234',
  CL: '221234567',
  CM: '671234567',
  CN: '13123456789',
  CO: '3211234567',
  CR: '83123456',
  CU: '51234567',
  CV: '9911234',
  CW: '95181234',
  CX: '412345678',
  CY: '96123456',
  CZ: '601123456',
  DE: '15123456789',
  DJ: '77831001',
  DK: '34412345',
  DM: '7672251234',
  DO: '8092345678',
  DZ: '551234567',
  EC: '991234567',
  EE: '51234567',
  EG: '1001234567',
  EH: '650123456',
  ER: '7123456',
  ES: '612345678',
  ET: '911234567',
  FI: '412345678',
  FJ: '7012345',
  FK: '51234',
  FM: '3501234',
  FO: '211234',
  FR: '612345678',
  GA: '06031234',
  GB: '7400123456',
  GD: '4734031234',
  GE: '555123456',
  GF: '694201234',
  GG: '7781123456',
  GH: '231234567',
  GI: '57123456',
  GL: '221234',
  GM: '3012345',
  GN: '601123456',
  GP: '690001234',
  GQ: '222123456',
  GR: '6912345678',
  GT: '51234567',
  GU: '6713001234',
  GW: '955012345',
  GY: '6091234',
  HK: '51234567',
  HN: '91234567',
  HR: '921234567',
  HT: '34101234',
  HU: '201234567',
  ID: '812345678',
  IE: '850123456',
  IL: '502345678',
  IM: '7924123456',
  IN: '8123456789',
  IO: '3801234',
  IQ: '7912345678',
  IR: '9123456789',
  IS: '6111234',
  IT: '3123456789',
  JE: '7797712345',
  JM: '8762101234',
  JO: '790123456',
  JP: '9012345678',
  KE: '712123456',
  KG: '700123456',
  KH: '91234567',
  KI: '72001234',
  KM: '3212345',
  KN: '8697652917',
  KP: '1921234567',
  KR: '1020000000',
  KW: '50012345',
  KY: '3453231234',
  KZ: '7710009998',
  LA: '2023123456',
  LB: '71123456',
  LC: '7582845678',
  LI: '660234567',
  LK: '712345678',
  LR: '770123456',
  LS: '50123456',
  LT: '61234567',
  LU: '628123456',
  LV: '21234567',
  LY: '912345678',
  MA: '650123456',
  MC: '612345678',
  MD: '62112345',
  ME: '60123456',
  MF: '690001234',
  MG: '321234567',
  MH: '2351234',
  MK: '72345678',
  ML: '65012345',
  MM: '92123456',
  MN: '88123456',
  MO: '66123456',
  MP: '6702345678',
  MQ: '696201234',
  MR: '22123456',
  MS: '6644923456',
  MT: '96961234',
  MU: '52512345',
  MV: '7712345',
  MW: '991234567',
  MX: '2221234567',
  MY: '123456789',
  MZ: '821234567',
  NA: '811234567',
  NC: '751234',
  NE: '93123456',
  NF: '381234',
  NG: '8021234567',
  NI: '81234567',
  NL: '612345678',
  NO: '40612345',
  NP: '9841234567',
  NR: '5551234',
  NU: '8884012',
  NZ: '211234567',
  OM: '92123456',
  PA: '61234567',
  PE: '912345678',
  PF: '87123456',
  PG: '70123456',
  PH: '9051234567',
  PK: '3012345678',
  PL: '512345678',
  PM: '551234',
  PR: '7872345678',
  PS: '599123456',
  PT: '912345678',
  PW: '6201234',
  PY: '961456789',
  QA: '33123456',
  RE: '692123456',
  RO: '712034567',
  RS: '601234567',
  RU: '9123456789',
  RW: '720123456',
  SA: '512345678',
  SB: '7421234',
  SC: '2510123',
  SD: '911231234',
  SE: '701234567',
  SG: '81234567',
  SH: '51234',
  SI: '31234567',
  SJ: '41234567',
  SK: '912123456',
  SL: '25123456',
  SM: '66661212',
  SN: '701234567',
  SO: '71123456',
  SR: '7412345',
  SS: '977123456',
  ST: '9812345',
  SV: '70123456',
  SX: '7215205678',
  SY: '944567890',
  SZ: '76123456',
  TA: '8999',
  TC: '6492311234',
  TD: '63012345',
  TG: '90112345',
  TH: '812345678',
  TJ: '917123456',
  TK: '7290',
  TL: '77212345',
  TM: '66123456',
  TN: '20123456',
  TO: '7715123',
  TR: '5012345678',
  TT: '8682911234',
  TV: '901234',
  TW: '912345678',
  TZ: '621234567',
  UA: '501234567',
  UG: '712345678',
  US: '2015550123',
  UY: '94231234',
  UZ: '912345678',
  VA: '3123456789',
  VC: '7844301234',
  VE: '4121234567',
  VG: '2843001234',
  VI: '3406421234',
  VN: '912345678',
  VU: '5912345',
  WF: '821234',
  WS: '7212345',
  XK: '43201234',
  YE: '712345678',
  YT: '639012345',
  ZA: '711234567',
  ZM: '955123456',
  ZW: '712345678'
};

const displayNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["es"], { type: "region" })
    : null;

export const phoneCountries: PhoneCountryOption[] = getCountries().map((country) => {
  const name = displayNames?.of(country) ?? country;
  return {
    code: country,
    dialCode: `+${getCountryCallingCode(country)}`,
    name,
    displayName: countryShortDisplayNames[country] ?? name,
    flag: countryToFlag(country),
    isoCode: country,
    shortCode: countryShortCodes[country] ?? country,
  };
});

export function normalizeCountrySearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
}

const countryNameSort = (a: PhoneCountryOption, b: PhoneCountryOption) =>
  a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });

export const primaryPhoneCountries = primaryCountryCodes
  .map(code => phoneCountries.find(country => country.code === code))
  .filter((country): country is PhoneCountryOption => Boolean(country));

const primaryCountrySet = new Set(primaryCountryCodes);
export const otherPhoneCountries = phoneCountries
  .filter(country => !primaryCountrySet.has(country.code))
  .sort(countryNameSort);

export function countryToFlag(country: string) {
  return country
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

export function formatPhoneInput(value: string, country: PhoneCountry) {
  const safeValue = value.replace(/[^0-9+()\-\s]/g, "");
  return new AsYouType(country).input(safeValue);
}

export function normalizePhone(value: string, country: PhoneCountry) {
  const trimmed = value.trim();
  const compact = trimmed.replace(/\D/g, '');
  let parsed = parsePhoneNumberFromString(trimmed, country);

  if (country === 'AR' && trimmed && !trimmed.startsWith('+') && !compact.startsWith('0')) {
    const mobileCandidate = parsePhoneNumberFromString(`+549${compact}`);
    if (mobileCandidate?.isValid() && mobileCandidate.getType() === 'MOBILE') parsed = mobileCandidate;
    else if (parsed?.getType() !== 'MOBILE') return null;
  }

  if (!parsed || !parsed.isValid()) return null;
  return {
    e164: parsed.number,
    display: parsed.formatInternational(),
    country: parsed.country ?? country,
  };
}

export function formatPhoneDisplay(value: string) {
  const parsed = parsePhoneNumberFromString(value);
  return parsed?.isValid() ? parsed.formatInternational() : value;
}

/**
 * Formatea un número de teléfono con la bandera de su país y el formato internacional de WhatsApp.
 * Si es de Argentina (+54 9), usa el formato "+54 9 11 3399-2102".
 * Si no hay información suficiente para identificar el país, no inventa la bandera.
 */
export function formatPhoneWithCountryAndWhatsApp(rawPhone?: string | null): {
  display: string;
  e164: string;
  flag: string;
} {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { display: '', e164: '', flag: '' };
  }

  const trimmed = rawPhone.trim();
  let parsed = parsePhoneNumberFromString(trimmed);
  if (!parsed || !parsed.isValid()) {
    const compact = trimmed.replace(/\D/g, '');
    const mobileAr = parsePhoneNumberFromString(`+549${compact}`);
    if (mobileAr?.isValid()) {
      parsed = mobileAr;
    } else {
      parsed = parsePhoneNumberFromString(trimmed, 'AR');
    }
  }

  if (parsed && (parsed.isValid() || parsed.isPossible()) && parsed.country) {
    const country = parsed.country;
    const flag = country ? countryToFlag(country) : '';
    let intl = parsed.formatInternational ? parsed.formatInternational() : trimmed;

    // Formato de WhatsApp para números de Argentina (+54 9): unir los últimos dos bloques con guión
    if (country === 'AR') {
      const parts = intl.split(' ');
      if (parts.length >= 4) {
        const lastPart = parts.pop();
        parts[parts.length - 1] = `${parts[parts.length - 1]}-${lastPart}`;
        intl = parts.join(' ');
      }
    }

    return {
      display: flag ? `${flag} ${intl}` : intl,
      e164: parsed.number || trimmed,
      flag,
    };
  }

  // Fallback si no es un número parseable
  const digitsOnly = trimmed.replace(/[^\d+]/g, '');
  return {
    display: trimmed,
    e164: digitsOnly.startsWith('+') ? digitsOnly : (digitsOnly ? `+${digitsOnly}` : ''),
    flag: '',
  };
}

/**
 * Normaliza un número telefónico y genera un enlace directo a WhatsApp (https://wa.me/<digits>).
 * Para números de Argentina (+54), asegura el formato internacional wa.me con código 54 seguido de 9
 * y código de área sin el 15. No duplica el 54 ni el 9.
 * Para otros países, conserva el código internacional sin prefijos adicionales.
 * Si el número está vacío o no es interpretable, retorna null para no renderizar enlaces rotos.
 */
export function getWhatsAppUrl(rawPhone?: string | null): string | null {
  if (!rawPhone || typeof rawPhone !== 'string') return null;
  const trimmed = rawPhone.trim();
  if (!trimmed) return null;

  let parsed = parsePhoneNumberFromString(trimmed);
  if (!parsed || !parsed.isValid()) {
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return null;

    if (digits.startsWith('549') && digits.length >= 12) {
      parsed = parsePhoneNumberFromString(`+${digits}`);
    } else if (digits.startsWith('54') && digits.length >= 12) {
      parsed = parsePhoneNumberFromString(`+549${digits.slice(2).replace(/^0+/, '')}`);
    } else if (trimmed.startsWith('+')) {
      parsed = parsePhoneNumberFromString(trimmed);
    } else {
      parsed = parsePhoneNumberFromString(`+549${digits.replace(/^0+/, '').replace(/^15/, '')}`);
    }
  }

  if (parsed && (parsed.isValid() || parsed.isPossible())) {
    let num = parsed.number;
    if (parsed.country === 'AR') {
      if (num.startsWith('+54') && !num.startsWith('+549')) {
        num = `+549${num.slice(3)}`;
      }
    }
    const cleanDigits = num.replace(/\D/g, '');
    if (cleanDigits.length >= 8) {
      return `https://wa.me/${cleanDigits}`;
    }
  }

  // Fallback seguro si no se pudo parsear formalmente pero tiene dígitos suficientes
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length >= 8) {
    let cleanDigits = digitsOnly;
    if (cleanDigits.startsWith('549')) {
      // ya tiene formato 549...
    } else if (cleanDigits.startsWith('54')) {
      cleanDigits = `549${cleanDigits.slice(2)}`;
    } else if (cleanDigits.length === 10) {
      cleanDigits = `549${cleanDigits}`;
    }
    return `https://wa.me/${cleanDigits}`;
  }

  return null;
}

export function phonePlaceholder(country: PhoneCountry) {
  const example = mobileExampleNumbers[country];
  if (!example) return 'Número de celular';
  return new AsYouType(country).input(example);
}

/**
 * Normaliza un número de teléfono para comparación y consolidación unívoca de clientes.
 * Preserva código de país, normaliza celulares argentinos (+549) y tolera separadores.
 */
export function normalizePhoneForComparison(phone?: string | null): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  if (!trimmed) return '';

  let num = '';
  try {
    const parsed = parsePhoneNumberFromString(trimmed, 'AR');
    if (parsed && parsed.isValid()) {
      num = parsed.number;
    }
  } catch {
    // ignorar error de parseo y continuar
  }

  if (!num) {
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 11) {
      try {
        const candidate = parsePhoneNumberFromString(`+549${digits.replace(/^0+/, '')}`, 'AR');
        if (candidate && candidate.isValid()) {
          num = candidate.number;
        }
      } catch {
        // ignorar
      }
    }
  }

  // En Argentina (+54), libphonenumber agrega '9' para móviles internacionales (+54911...).
  // Para comparación y consolidación unívoca, normalizamos removiendo el '9' si está presente.
  if (num.startsWith('+549') && num.length === 14) {
    num = `+54${num.slice(4)}`;
  }

  if (num) return num;

  // Fallback: dígitos normalizados si tiene longitud suficiente
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length >= 7) {
    return trimmed.startsWith('+') ? `+${digitsOnly}` : digitsOnly;
  }

  return '';
}

/**
 * Normaliza un correo electrónico para comparación y consolidación unívoca de clientes.
 * Elimina espacios iniciales/finales, pasa a minúsculas y excluye placeholders internos.
 */
export function normalizeEmailForComparison(email?: string | null): string {
  if (!email) return '';
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes('@') || trimmed.endsWith('@kanibarber.internal')) {
    return '';
  }
  return trimmed;
}

