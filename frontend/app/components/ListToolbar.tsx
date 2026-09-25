"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  ChevronDown,
  ListFilter,
  Plus,
  Search,
} from "lucide-react";

export type SortMenuOption = {
  value: string;
  label: string;
  direction?: "desc" | "asc";
};

type ListViewMode = "table" | "cards";

type Props = {
  addLabel?: string;
  onAdd?: () => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: ReactNode;
  // Sort Popover configuration
  sortOptions?: SortMenuOption[];
  currentSort?: string;
  onSortChange?: (value: string) => void;
  // Legacy fallback toggle
  onSort?: () => void;
  sortTitle?: string;
  viewMode?: ListViewMode;
  onViewModeChange?: (mode: ListViewMode) => void;
};

export default function ListToolbar({
  addLabel,
  onAdd,
  searchValue = "",
  onSearchChange,
  searchPlaceholder = "Cari kata kunci...",
  filters,
  sortOptions,
  currentSort,
  onSortChange,
  onSort,
  sortTitle = "Urutkan data",
}: Props) {
  const [sortOpen, setSortOpen] = useState(false);
  const sortContainerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (!sortContainerRef.current?.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    if (sortOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [sortOpen]);

  const activeOption = sortOptions?.find((opt) => opt.value === currentSort);

  return (
    <div className="list-toolbar">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {onAdd && (
          <button type="button" onClick={onAdd} className="btn-primary list-toolbar-add">
            <Plus size={16} /> {addLabel ?? "Tambah"}
          </button>
        )}
        <label className="list-toolbar-search">
          <Search size={18} aria-hidden="true" />
          <input
            value={searchValue}
            onChange={(event) => onSearchChange?.(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        </label>
        {filters && <div className="flex items-center gap-2">{filters}</div>}
      </div>

      <div className="flex items-center gap-2">
        {/* Interactive Sort Popover */}
        {sortOptions && onSortChange ? (
          <div ref={sortContainerRef} className="relative">
            <button
              type="button"
              onClick={() => setSortOpen((prev) => !prev)}
              className={`list-toolbar-icon gap-1 px-2.5 transition-all ${
                sortOpen || currentSort === "OLDEST"
                  ? "!border-primary !text-primary bg-primary/10 shadow-sm"
                  : ""
              }`}
              aria-haspopup="listbox"
              aria-expanded={sortOpen}
              aria-label={`Urutan data: ${activeOption?.label ?? "Urutkan"}`}
              title={`Urutan: ${activeOption?.label ?? "Urutkan"}`}
            >
              {activeOption?.direction === "asc" ? (
                <ArrowUpNarrowWide size={17} className="text-primary" />
              ) : (
                <ArrowDownWideNarrow size={17} className="text-primary" />
              )}
              <ChevronDown
                size={13}
                className={`transition-transform duration-200 ${sortOpen ? "rotate-180" : ""}`}
              />
            </button>

            {/* Dropdown Menu */}
            {sortOpen && (
              <div
                role="listbox"
                className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[240px] rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-1.5 shadow-2xl animate-fade-in"
              >
                <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                  Urutkan Berdasarkan
                </div>
                <div className="space-y-0.5">
                  {sortOptions.map((opt) => {
                    const isSelected = opt.value === currentSort;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => {
                          onSortChange(opt.value);
                          setSortOpen(false);
                        }}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                          isSelected
                            ? "bg-primary/15 text-primary font-semibold"
                            : "text-on-surface hover:bg-surface-container-high"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {opt.direction === "asc" ? (
                            <ArrowUpNarrowWide size={14} className={isSelected ? "text-primary" : "text-on-surface-variant"} />
                          ) : (
                            <ArrowDownWideNarrow size={14} className={isSelected ? "text-primary" : "text-on-surface-variant"} />
                          )}
                          <span>{opt.label}</span>
                        </div>
                        {isSelected && <Check size={14} className="text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : onSort ? (
          /* Fallback for components with simple click handlers */
          <button
            type="button"
            onClick={onSort}
            className="list-toolbar-icon"
            aria-label={sortTitle}
            title={sortTitle}
          >
            <ListFilter size={18} />
            <ChevronDown size={14} />
          </button>
        ) : null}

      </div>
    </div>
  );
}
