import { useState, useRef, useEffect, useMemo, type ChangeEvent, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import {
  formatPhoneInput,
  normalizeCountrySearch,
  phoneCountries,
  phonePlaceholder,
  primaryPhoneCountries,
  otherPhoneCountries,
  type PhoneCountry,
  type PhoneCountryOption,
} from '@/lib/kani-phone';
import { cn } from '@/lib/utils';

export interface PhoneInputProps {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  country: PhoneCountry;
  onCountryChange: (country: PhoneCountry) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  triggerClassName?: string;
  controlClassName?: string;
  feedback?: ReactNode;
  size?: 'default' | 'sm';
  onBlur?: () => void;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-describedby'?: string;
}

export function PhoneInput({
  id,
  name,
  value,
  onChange,
  country,
  onCountryChange,
  disabled = false,
  required = false,
  placeholder,
  className,
  inputClassName,
  triggerClassName,
  controlClassName,
  feedback,
  size = 'default',
  onBlur,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: PhoneInputProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const filteredCountries = useMemo(() => {
    const q = normalizeCountrySearch(query.trim());
    const filter = (countries: PhoneCountryOption[]) =>
      q
        ? countries.filter(c =>
            normalizeCountrySearch(`${c.name} ${c.shortCode} ${c.dialCode}`).includes(q)
          )
        : countries;
    return {
      primary: filter(primaryPhoneCountries),
      other: filter(otherPhoneCountries),
    };
  }, [query]);

  const selectedCountry = useMemo(
    () => phoneCountries.find(c => c.code === country) ?? phoneCountries[0],
    [country]
  );

  const handleSelectCountry = (targetCountry: PhoneCountry) => {
    onCountryChange(targetCountry);
    if (value) {
      onChange(formatPhoneInput(value, targetCountry));
    }
    setOpen(false);
    setQuery('');
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(formatPhoneInput(e.target.value, country));
  };

  const inputElement = (
    <Input
      id={id}
      name={name}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      required={required}
      disabled={disabled}
      value={value}
      onChange={handleInputChange}
      onBlur={onBlur}
      placeholder={placeholder || phonePlaceholder(country)}
      className={cn(
        "bg-background",
        size === 'sm' ? "h-10 text-xs sm:text-sm" : "h-[52px]",
        inputClassName
      )}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );

  return (
    <div
      className={cn(
        "phone-input-row items-center",
        size === 'sm' && "admin-phone-input-row",
        className
      )}
    >
      <div className="phone-country-picker" ref={pickerRef}>
        <button
          type="button"
          className={cn(
            "phone-country-trigger",
            size === 'sm' && "is-compact",
            triggerClassName
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`País: ${selectedCountry?.name}, ${selectedCountry?.shortCode}, ${selectedCountry?.dialCode}`}
          disabled={disabled}
          onClick={() => {
            setOpen(prev => !prev);
            setQuery('');
          }}
        >
          <span aria-hidden="true">{selectedCountry?.flag}</span>
          <span aria-hidden="true" className="whitespace-nowrap">
            {selectedCountry?.shortCode} ({selectedCountry?.dialCode})
          </span>
        </button>

        {open && (
          <div className="phone-country-options" role="listbox" aria-label="Seleccionar país">
            <input
              className="phone-country-search"
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Buscar país"
              aria-label="Buscar país"
              autoFocus
            />

            {filteredCountries.primary.length > 0 && (
              <div className="phone-country-group">
                <p className="phone-country-group-title">Países principales</p>
                {filteredCountries.primary.map(c => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={country === c.code}
                    className="phone-country-option"
                    key={c.code}
                    onClick={() => handleSelectCountry(c.code)}
                  >
                    <span>{c.flag} {c.name}</span>
                    <span>{c.shortCode} · {c.dialCode}</span>
                  </button>
                ))}
              </div>
            )}

            {filteredCountries.other.length > 0 && (
              <div className="phone-country-group">
                <p className="phone-country-group-title">Otros países</p>
                {filteredCountries.other.map(c => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={country === c.code}
                    className="phone-country-option"
                    key={c.code}
                    onClick={() => handleSelectCountry(c.code)}
                  >
                    <span>{c.flag} {c.name}</span>
                    <span>{c.shortCode} · {c.dialCode}</span>
                  </button>
                ))}
              </div>
            )}

            {filteredCountries.primary.length === 0 && filteredCountries.other.length === 0 && (
              <p className="phone-country-empty">No encontramos ese país.</p>
            )}
          </div>
        )}
      </div>

      {controlClassName || feedback ? (
        <span className={cn("field-control h-[52px] flex items-center", size === 'sm' && "h-10", controlClassName)}>
          {inputElement}
          {feedback}
        </span>
      ) : (
        inputElement
      )}
    </div>
  );
}
