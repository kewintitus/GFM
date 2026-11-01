import { useEffect, useId, useRef, useState } from "react";

export interface AutocompleteOption {
  value: string;
  label: string;
}

interface AutocompleteProps {
  value: string;
  options: AutocompleteOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
}

export function Autocomplete({
  value,
  options,
  onChange,
  placeholder = "Select",
  disabled = false,
  invalid = false,
  allowEmpty = true,
  emptyLabel = "No matches"
}: AutocompleteProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const selected = options.find((option) => option.value === value);
  const needle = query.trim().toLowerCase();
  const filtered = options.filter((option) => {
    if (!needle) {
      return true;
    }
    return option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle);
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery("");
    setHighlight(0);
  };

  return (
    <div className={open ? "combo is-open" : "combo"} ref={rootRef}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={invalid}
        aria-autocomplete="list"
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? "")}
        onFocus={() => {
          if (disabled) {
            return;
          }
          setOpen(true);
          setQuery("");
          setHighlight(0);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setHighlight((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            const option = filtered[highlight];
            if (option) {
              choose(option.value);
            }
          } else if (event.key === "Escape") {
            setOpen(false);
            setQuery("");
          } else if (event.key === "Backspace" && !query && allowEmpty && selected) {
            onChange("");
          }
        }}
        onBlur={() => {
          const exact = filtered.find((option) => option.label.toLowerCase() === needle || option.value.toLowerCase() === needle);
          if (exact) {
            onChange(exact.value);
          }
          setQuery("");
        }}
      />
      {open ? (
        <ul id={listId} role="listbox" className="combo-menu">
          {filtered.length === 0 ? <li className="combo-empty">{emptyLabel}</li> : filtered.map((option, index) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={index === highlight ? "is-active" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(option.value)}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
