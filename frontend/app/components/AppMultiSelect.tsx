"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import type { SelectOption } from "./AppSelect";

type Props = {
  value: string[];
  onValueChange: (value: string[]) => void;
  options: SelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  clearLabel?: string;
  selectedCountLabel?: string;
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
  disabled = false,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selectedOptions = options.filter((option) => value.includes(option.value));
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
          {options.map((option) => {
            const isSelected = value.includes(option.value);
            return (
              <label key={option.value} className="app-select-option app-multi-select-option cursor-pointer">
                <input type="checkbox" checked={isSelected} onChange={() => toggleOption(option.value)} />
                <span className={isSelected ? "font-semibold text-primary" : "text-on-surface"}>{option.label}</span>
              </label>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
