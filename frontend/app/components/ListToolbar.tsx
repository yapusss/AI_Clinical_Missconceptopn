"use client";

import type { ReactNode } from "react";
import { ChevronDown, Filter, Grid2X2, ListFilter, Plus, Search, SlidersHorizontal } from "lucide-react";

type Props = {
  addLabel?: string;
  onAdd?: () => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: ReactNode;
  onSort?: () => void;
  onView?: () => void;
};

export default function ListToolbar({ addLabel, onAdd, searchValue = "", onSearchChange, searchPlaceholder = "Cari kata kunci...", filters, onSort, onView }: Props) {
  return <div className="list-toolbar"><div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{onAdd && <button type="button" onClick={onAdd} className="btn-primary list-toolbar-add"><Plus size={16} /> {addLabel ?? "Tambah"}</button>}<label className="list-toolbar-search"><Search size={18} aria-hidden="true" /><input value={searchValue} onChange={(event) => onSearchChange?.(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} /></label>{filters && <div className="flex items-center gap-2">{filters}</div>}</div><div className="flex items-center gap-2"><button type="button" onClick={onSort} className="list-toolbar-icon" aria-label="Urutkan data" title="Urutkan data"><ListFilter size={18} /><ChevronDown size={14} /></button><button type="button" onClick={onView} className="list-toolbar-icon" aria-label="Ubah tampilan" title="Ubah tampilan"><Grid2X2 size={17} /></button></div></div>;
}
