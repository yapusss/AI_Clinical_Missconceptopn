"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import type { SelectOption } from "./AppSelect";

type Props = {
  value: string[];
  onValueChange: (value: string[]) => void;
  options: SelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  clearLabel?: string;
  selectedCountLabel?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
};

export default function AppMultiSelect({
  value,
  onValueChange,
  options,
  placeholder = "Pilih opsi...",
  ariaLabel = "Pilih beberapa opsi",
  clearLabel = "Hapus semua pilihan",
  selectedCountLabel = "opsi dipilih",
  searchable = false,
  searchPlaceholder = "Cari...",
  disabled = false,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selectedOptions = options.filter((option) => value.includes(option.value));
  const filteredOptions = options.filter((option) =>
    option.label.toLocaleLowerCase("id-ID").includes(query.toLocaleLowerCase("id-ID")),
  );
  const selectionText = selectedOptions.length === 0
    ? placeholder
    : selectedOptions.length <= 2
      ? selectedOptions.map((option) => option.label).join(", ")
      : `${selectedOptions.length} ${selectedCountLabel}`;

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const updateMenuPosition = () => {
      const rect = root.current?.getBoundingClientRect();
      if (rect) {
        setMenuPosition({ top: rect.bottom + 6, left: rect.left, width: rect.width });
      }
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  function toggleOption(optionValue: string) {
    onValueChange(value.includes(optionValue) ? value.filter((item) => item !== optionValue) : [...value, optionValue]);
  }

  return (
    <div ref={root} className={`app-select app-multi-select ${open ? "app-select-open" : ""} ${className}`}>
      <div className="app-multi-select-control">
        <button
          id={id}
          type="button"
          className="app-select-trigger cursor-pointer"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={ariaLabel}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="truncate pr-2">{selectionText}</span>
          <ChevronDown size={16} className={`shrink-0 text-on-surface-variant/80 transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {selectedOptions.length > 0 && !disabled && (
          <button type="button" className="app-multi-select-clear" onClick={() => onValueChange([])} aria-label={clearLabel} title={clearLabel}>
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && menuPosition && typeof document !== "undefined" && createPortal(
        <div
          ref={menu}
          className="app-select-menu app-multi-select-menu shadow-2xl animate-fade-in"
          style={{ position: "fixed", top: menuPosition.top, left: menuPosition.left, width: menuPosition.width, zIndex: 1000 }}
          role="dialog"
          aria-labelledby={id}
          aria-label={ariaLabel}
        >
          {searchable && (
            <div className="border-b border-outline-variant/30 p-2">
              <label className="flex items-center gap-2 rounded-md border border-outline-variant/40 bg-surface-container-lowest px-2.5 py-2 text-on-surface-variant focus-within:border-primary">
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="min-w-0 flex-1 bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant"
                  autoFocus
                />
              </label>
            </div>
          )}
          {filteredOptions.map((option) => {
            const isSelected = value.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => toggleOption(option.value)}
                className="app-select-option app-multi-select-option w-full cursor-pointer"
              >
                <span className={isSelected ? "font-semibold text-primary" : "text-on-surface"}>{option.label}</span>
                {isSelected && <Check size={16} className="ml-auto shrink-0 text-primary" aria-hidden="true" />}
              </button>
            );
          })}
          {filteredOptions.length === 0 && (
            <p className="px-3 py-3 text-sm text-on-surface-variant">Tidak ada pilihan yang cocok.</p>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
