"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = { value: string; label: string };

type Props = {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  trailingIcon?: ReactNode; // Supports custom icon (e.g. Filter) while keeping the trigger intact
};

export default function AppSelect({
  value,
  onValueChange,
  options,
  placeholder = "Pilih opsi...",
  disabled = false,
  className = "",
  ariaLabel,
  trailingIcon,
}: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  // Close dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <div ref={root} className={`app-select ${className}`}>
      {/* Clickable Trigger Button (keeps text and custom icon) */}
      <button
        id={id}
        type="button"
        className="app-select-trigger cursor-pointer"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? placeholder}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="truncate pr-2">{selected?.label ?? placeholder}</span>
        {trailingIcon ? (
          <span className="shrink-0 text-on-surface-variant/80 transition-colors">
            {trailingIcon}
          </span>
        ) : (
          <ChevronDown
            size={16}
            className={`shrink-0 text-on-surface-variant/80 transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          />
        )}
      </button>

      {/* Existing Lecturer-view Dropdown Choice Style */}
      {open && (
        <div
          className="app-select-menu min-w-full w-max max-w-xs shadow-2xl animate-fade-in"
          role="listbox"
          aria-labelledby={id}
        >
          {options
            .filter((option) => option.label !== placeholder)
            .map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className="app-select-option cursor-pointer transition-colors"
                  onClick={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className={isSelected ? "font-semibold text-primary" : "text-on-surface"}>
                    {option.label}
                  </span>
                  {isSelected && <Check size={16} className="text-primary shrink-0 ml-2" />}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}