/** Shared visual elements of the existing customer confirmation email. */
export const confirmationEmailFonts = {
  body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  title: "'DM Serif Display', Georgia, 'Times New Roman', serif",
};

export function confirmationEmailLogo(logoUrl: string) {
  return `<img src="${logoUrl}" alt="Kani Barber Studio" width="180" style="display: block; width: 180px; max-width: 100%; height: auto; border: 0; margin: 0 auto; font-family: 'DM Serif Display', Georgia, serif; font-size: 22px; font-weight: 700; color: #B99A5B; text-align: center;" />`;
}
