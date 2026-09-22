"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = { value: string; label: string };
type Props = { value: string; onValueChange: (value: string) => void; options: SelectOption[]; placeholder?: string; disabled?: boolean; className?: string; ariaLabel?: string };

export default function AppSelect({ value, onValueChange, options, placeholder = "Pilih opsi...", disabled = false, className = "", ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  useEffect(() => { const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  return <div ref={root} className={`app-select ${className}`}><button id={id} type="button" className="app-select-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel ?? placeholder} onClick={() => setOpen((current) => !current)}><span>{selected?.label ?? placeholder}</span><ChevronDown size={18} className={open ? "rotate-180" : ""} /></button>{open && <div className="app-select-menu" role="listbox" aria-labelledby={id}>{options.filter((option) => option.label !== placeholder).map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className="app-select-option" onClick={() => { onValueChange(option.value); setOpen(false); }}><span>{option.label}</span>{option.value === value && <Check size={16} />}</button>)}</div>}</div>;
}
