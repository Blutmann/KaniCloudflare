import * as React from "react";
import { Check, ChevronDown, Search, UserRound } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type AdminClientOption = {
  id: string;
  name: string;
  phone?: string | null;
};

type AdminClientComboboxProps = {
  clients: AdminClientOption[];
  value: string;
  onChange: (clientId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  ariaLabel?: string;
};

/**
 * Searchable client selector for mobile/desktop admin modals.
 * Keeps selection bound to the canonical `client.id` without duplicating records.
 */
export function AdminClientCombobox({
  clients,
  value,
  onChange,
  placeholder = "Seleccionar cliente…",
  disabled = false,
  required = false,
  id,
  ariaLabel = "Seleccionar cliente",
}: AdminClientComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listboxId = React.useId();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const selectedClient = React.useMemo(
    () => clients.find((c) => c.id === value) ?? null,
    [clients, value],
  );

  const filteredClients = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    const digitsQuery = q.replace(/\D/g, "");
    return clients.filter((c) => {
      const nameMatch = c.name.toLowerCase().includes(q);
      const phoneStr = (c.phone ?? "").toLowerCase();
      const phoneMatch = phoneStr.includes(q);
      const digitsMatch =
        digitsQuery.length > 0 && phoneStr.replace(/\D/g, "").includes(digitsQuery);
      return nameMatch || phoneMatch || digitsMatch;
    });
  }, [clients, query]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus({ preventScroll: true });
    }, 30);
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  const handleSelect = (clientId: string) => {
    onChange(clientId);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) =>
        filteredClients.length === 0 ? 0 : (prev + 1) % filteredClients.length,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) =>
        filteredClients.length === 0
          ? 0
          : (prev - 1 + filteredClients.length) % filteredClients.length,
      );
    } else if (e.key === "Enter") {
      if (filteredClients[activeIndex]) {
        e.preventDefault();
        handleSelect(filteredClients[activeIndex].id);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative min-w-0 w-full">
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value}
          onChange={() => {}}
          className="sr-only"
        />
      )}
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        className={cn(
          "v2-admin-select-trigger flex h-[44px] min-h-[44px] w-full min-w-0 max-w-full items-center justify-between gap-2.5 overflow-hidden rounded-[var(--v2-radius-btn,12px)] border border-input bg-background px-3 py-0 text-left text-[14px] leading-none text-foreground shadow-xs transition-colors focus:outline-none focus:ring-1 focus:ring-gold disabled:cursor-not-allowed disabled:opacity-50",
          !selectedClient && "text-muted-foreground",
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden text-left">
          <UserRound size={16} className="shrink-0 text-gold" aria-hidden="true" />
          <span className="block min-w-0 flex-1 truncate leading-[1.35]">
            {selectedClient
              ? `${selectedClient.name}${selectedClient.phone ? ` (${selectedClient.phone})` : ""}`
              : placeholder}
          </span>
        </span>
        <ChevronDown size={16} className="ml-1 shrink-0 opacity-60" aria-hidden="true" />
      </button>
      {open && (
        <div className="v2-admin-combobox-popover relative mt-1.5 w-full overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
            <Search size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Buscar por nombre o celular…"
              aria-label="Buscar cliente por nombre o celular"
              aria-controls={listboxId}
              aria-activedescendant={
                filteredClients[activeIndex]
                  ? `${listboxId}-opt-${filteredClients[activeIndex].id}`
                  : undefined
              }
              className="w-full min-w-0 bg-transparent text-[16px] sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Clientes"
            className="v2-admin-combobox-list max-h-[190px] overflow-y-auto overscroll-contain p-1"
            style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
          >
            {filteredClients.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-muted-foreground">
                No se encontraron clientes para “{query}”.
              </li>
            ) : (
              filteredClients.map((c, index) => {
                const isSelected = c.id === value;
                const isActive = index === activeIndex;
                return (
                  <li
                    key={c.id}
                    id={`${listboxId}-opt-${c.id}`}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(c.id)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                        isSelected
                          ? "bg-gold/15 font-medium text-foreground"
                          : isActive
                            ? "bg-accent text-accent-foreground"
                            : "text-foreground hover:bg-accent/60",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{c.name}</span>
                        {c.phone && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {c.phone}
                          </span>
                        )}
                      </span>
                      {isSelected && (
                        <Check size={15} className="shrink-0 text-gold" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export type AdminSelectOption = {
  value: string;
  label: string;
};

type AdminContextualSelectProps = {
  options: AdminSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
};

/**
 * Accessible Liquid Glass contextual select using Radix Select.
 * Respects viewport bounds, flips upward when needed, and prevents label truncation.
 */
export function AdminContextualSelect({
  options,
  value,
  onValueChange,
  placeholder = "Seleccionar…",
  disabled = false,
  ariaLabel,
  id,
}: AdminContextualSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className="v2-admin-select-trigger min-h-[44px] h-auto w-full text-left text-sm whitespace-normal"
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="v2-admin-select-content max-w-[calc(100vw-24px)]">
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="py-2 text-sm">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
