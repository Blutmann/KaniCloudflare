import React from 'react';
import { CreditCard } from 'lucide-react';
import type { SupportedCardBrand } from '@/lib/kani-card-validation';

export function CardBrandBadge({
  brand,
  className = '',
}: {
  brand: SupportedCardBrand | 'other' | null;
  className?: string;
}) {
  if (brand === 'visa') {
    return (
      <span className={`inline-flex items-center justify-center ${className}`} title="Visa" aria-label="Visa">
        <svg
          viewBox="0 0 48 32"
          width="36"
          height="24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-auto rounded border border-border/40 bg-white/95 px-1 py-0.5 shadow-sm"
        >
          <path
            d="M19.4 20.8h-2.6l1.6-10h2.6l-1.6 10zm11-9.8c-.5-.2-1.3-.4-2.3-.4-2.5 0-4.3 1.3-4.3 3.2 0 1.4 1.3 2.2 2.2 2.7.9.5 1.3.8 1.3 1.2 0 .6-.8.9-1.5.9-1 0-1.6-.2-2.4-.6l-.3-.2-.4 2.2c.6.3 1.8.5 2.9.5 2.7 0 4.5-1.3 4.5-3.3 0-1.1-.7-2-2.2-2.7-.9-.5-1.5-.8-1.5-1.2 0-.4.5-.8 1.4-.8.8 0 1.4.2 1.9.4l.2.1.5-2.3zm7.8 0h-2c-.6 0-1.1.2-1.3.8l-3.8 9h2.8l.5-1.5h3.4l.3 1.5h2.4l-2.3-9.8zm-3.1 6.3l1.4-3.9.8 3.9h-2.2zm-18.7-6.3l-2.6 6.8-.3-1.4c-.5-1.7-2.1-3.6-3.9-4.5l2.5 9.1h2.8l4.1-10h-2.6z"
            fill="#1A1F71"
          />
          <path
            d="M9.8 11h-4.3l-.1.4c3.4.8 5.6 2.9 6.5 5.3l-.9-4.8c-.2-.6-.6-.9-1.2-.9z"
            fill="#F7B600"
          />
        </svg>
      </span>
    );
  }

  if (brand === 'mastercard') {
    return (
      <span className={`inline-flex items-center justify-center ${className}`} title="Mastercard" aria-label="Mastercard">
        <svg
          viewBox="0 0 48 32"
          width="36"
          height="24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-auto rounded border border-border/40 bg-white/95 px-1 py-0.5 shadow-sm"
        >
          <circle cx="18" cy="16" r="10" fill="#EB001B" />
          <circle cx="30" cy="16" r="10" fill="#F79E1B" fillOpacity="0.9" />
          <path
            d="M24 8.7a9.98 9.98 0 0 1 4 7.3 9.98 9.98 0 0 1-4 7.3 9.98 9.98 0 0 1-4-7.3c0-2.8 1.5-5.3 4-7.3z"
            fill="#FF5F00"
          />
        </svg>
      </span>
    );
  }

  if (brand === 'cabal') {
    return (
      <span className={`inline-flex items-center justify-center ${className}`} title="Cabal" aria-label="Cabal">
        <span className="flex h-5 items-center rounded border border-border/40 bg-[#004B87] px-1.5 text-[10px] font-bold tracking-wider text-white shadow-sm">
          CABAL
        </span>
      </span>
    );
  }

  if (brand === 'american-express') {
    return (
      <span className={`inline-flex items-center justify-center ${className}`} title="American Express" aria-label="American Express">
        <span className="flex h-5 items-center rounded border border-border/40 bg-[#006FCF] px-1.5 text-[9px] font-extrabold tracking-wider text-white shadow-sm">
          AMEX
        </span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center justify-center text-muted-foreground ${className}`} aria-hidden="true">
      <CreditCard size={18} />
    </span>
  );
}
