import { describe, expect, it } from "vitest";
import { countryDisplayName, formatPhoneDisplay, formatPhoneInput, formatPhoneWithCountryAndWhatsApp, getWhatsAppUrl, normalizeCountrySearch, normalizePhone, otherPhoneCountries, phoneCountries, phonePlaceholder, primaryPhoneCountries } from "./kani-phone";

describe("phone normalization", () => {
  it("generates direct WhatsApp wa.me links correctly", () => {
    expect(getWhatsAppUrl("🇦🇷 +54 9 11 2843-6014")).toBe("https://wa.me/5491128436014");
    expect(getWhatsAppUrl("🇦🇷 +54 9 11 2345-6789")).toBe("https://wa.me/5491123456789");
    expect(getWhatsAppUrl("+5491128436014")).toBe("https://wa.me/5491128436014");
    expect(getWhatsAppUrl("1128436014")).toBe("https://wa.me/5491128436014");
    expect(getWhatsAppUrl("+56 9 8765 4321")).toBe("https://wa.me/56987654321");
    expect(getWhatsAppUrl("")).toBeNull();
    expect(getWhatsAppUrl("abc")).toBeNull();
    expect(getWhatsAppUrl(null)).toBeNull();
  });

  it("normalizes an Argentine mobile number to E.164", () => {
    expect(normalizePhone("9 11 0000-0000", "AR")?.e164).toBe("+5491100000000");
  });

  it("formats phone with country flag and WhatsApp format", () => {
    const res = formatPhoneWithCountryAndWhatsApp("+5491133992102");
    expect(res.flag).toBe("🇦🇷");
    expect(res.display).toBe("🇦🇷 +54 9 11 3399-2102");
    expect(res.e164).toBe("+5491133992102");
  });

  it("handles foreign numbers correctly with their flag and international format", () => {
    const cl = formatPhoneWithCountryAndWhatsApp("+56987654321");
    expect(cl.flag).toBe("🇨🇱");
    expect(cl.display).toContain("🇨🇱 +56 9 8765 4321");

    const br = formatPhoneWithCountryAndWhatsApp("+5511961234567");
    expect(br.flag).toBe("🇧🇷");
    expect(br.display).toContain("🇧🇷 +55 11 96123 4567");
  });

  it("does not invent a flag for invalid/unparseable phones", () => {
    const invalid = formatPhoneWithCountryAndWhatsApp("123");
    expect(invalid.flag).toBe("");
    expect(invalid.display).toBe("123");
  });

  it("adds Argentina's mobile access code to national Buenos Aires input", () => {
    expect(normalizePhone("1128436014", "AR")?.e164).toBe("+5491128436014");
  });

  it("adds Argentina's mobile access code to a valid interior input", () => {
    expect(normalizePhone("2923444395", "AR")?.e164).toBe("+5492923444395");
  });

  it("does not duplicate the country or mobile access code", () => {
    expect(normalizePhone("+54 9 11 2843-6014", "AR")?.e164).toBe("+5491128436014");
  });

  it("formats stored E.164 Argentine mobiles with international spacing", () => {
    expect(formatPhoneDisplay("+5491128436014")).toBe("+54 9 11 2843 6014");
  });

  it("keeps an Argentine fixed line without adding 9", () => {
    expect(normalizePhone("011 4444-1234", "AR")?.e164).toBe("+541144441234");
  });

  it("normalizes a Brazilian mobile number to E.164", () => {
    expect(normalizePhone("12 98829-1775", "BR")?.e164).toBe("+5512988291775");
  });

  it("formats while typing and rejects letters through the input helper", () => {
    expect(formatPhoneInput("9 11 ab0000-0000", "AR")).toBe("91100000000");
    expect(normalizePhone("123", "AR")).toBeNull();
    expect(normalizePhone("4444-1234", "AR")).toBeNull();
  });
});


describe("phone country labels", () => {
  it("uses short labels for common countries", () => {
    expect(phoneCountries.find(country => country.code === "AR")?.shortCode).toBe("ARG");
    expect(phoneCountries.find(country => country.code === "US")?.shortCode).toBe("USA");
    expect(phoneCountries.find(country => country.code === "BR")?.shortCode).toBe("BRA");
  });

  it("prioritizes the requested countries without losing the complete catalog", () => {
    expect(primaryPhoneCountries.map(country => country.code)).toEqual(["AR", "CL", "BR", "UY", "PY", "VE", "PE", "CO", "EC", "MX", "ES", "US"]);
    expect(new Set([...primaryPhoneCountries, ...otherPhoneCountries]).size).toBe(phoneCountries.length);
    expect(otherPhoneCountries.map(country => country.name).join("|"))
      .toBe([...otherPhoneCountries].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })).map(country => country.name).join("|"));
  });

  it("normalizes country searches with or without accents", () => {
    expect(normalizeCountrySearch("España")).toBe("espana");
    expect(normalizeCountrySearch("esPANA")).toBe("espana");
    expect(normalizeCountrySearch("Perú")).toBe("peru");
  });
});

describe("phone placeholders", () => {
  it("uses country-specific national examples for the requested countries", () => {
    expect(phonePlaceholder("AR")).toBe("11 2345-6789");
    expect(phonePlaceholder("BR")).toBe("(11) 96123-4567");
    expect(phonePlaceholder("CL")).toBe("(2) 2123 4567");
    expect(phonePlaceholder("UY")).toBe("94231234");
    expect(phonePlaceholder("US")).toBe("(201) 555-0123");
    expect(phonePlaceholder("ES")).toBe("612 34 56 78");
  });

  it("also provides examples for countries outside the primary group", () => {
    expect(phonePlaceholder("JP")).not.toBe(phonePlaceholder("AR"));
    expect(phonePlaceholder("DE")).not.toBe("Número de celular");
    expect(phonePlaceholder("AU")).not.toBe("Número de celular");
  });

  it("provides a country-specific example for every selectable country", () => {
    expect(phoneCountries.every(country => phonePlaceholder(country.code) !== "Número de celular")).toBe(true);
  });
});

describe("country display names", () => {
  it("displays full country names in Spanish for primary and standard countries", () => {
    const ar = phoneCountries.find(c => c.code === "AR");
    const br = phoneCountries.find(c => c.code === "BR");
    const uy = phoneCountries.find(c => c.code === "UY");
    const cl = phoneCountries.find(c => c.code === "CL");
    expect(countryDisplayName(ar)).toBe("Argentina");
    expect(countryDisplayName(br)).toBe("Brasil");
    expect(countryDisplayName(uy)).toBe("Uruguay");
    expect(countryDisplayName(cl)).toBe("Chile");
  });

  it("uses clean short friendly display names for countries with excessively long names", () => {
    const ag = phoneCountries.find(c => c.code === "AG");
    const ba = phoneCountries.find(c => c.code === "BA");
    const doCountry = phoneCountries.find(c => c.code === "DO");
    expect(countryDisplayName(ag)).toBe("Antigua");
    expect(countryDisplayName(ba)).toBe("Bosnia");
    expect(countryDisplayName(doCountry)).toBe("R. Dominicana");
  });
});
