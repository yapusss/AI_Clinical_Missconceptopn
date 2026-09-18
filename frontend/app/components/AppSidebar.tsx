"use client";

import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export type AppRole = "ADMIN" | "LECTURER" | "RESEARCHER" | "STUDENT" | "GENERAL";
export type AppMenuId = "dashboard" | "questions" | "settings" | "profile";

type MenuItem = {
  id: AppMenuId;
  label: string;
  icon: IconName;
  roles: AppRole[];
};

const ALL_ROLES: AppRole[] = ["ADMIN", "LECTURER", "RESEARCHER", "STUDENT", "GENERAL"];

const MENU_ITEMS: MenuItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "dashboard",
    roles: ALL_ROLES,
  },
  {
    id: "questions",
    label: "Soal",
    icon: "assignment",
    roles: ["ADMIN", "LECTURER", "STUDENT"],
  },
  {
    id: "settings",
    label: "Settings",
    icon: "settings",
    roles: ["ADMIN", "RESEARCHER"],
  },
  {
    id: "profile",
    label: "Profile",
    icon: "person",
    roles: ALL_ROLES,
  },
];

const ROLE_LABEL: Record<AppRole, string> = {
  ADMIN: "Administrator",
  LECTURER: "Dosen",
  RESEARCHER: "Peneliti",
  STUDENT: "Mahasiswa",
  GENERAL: "Akun umum",
};

type AppSidebarProps = {
  role: string;
  activeItem: AppMenuId;
  userName: string;
  onSelect: (item: AppMenuId) => void;
  onLogout: () => void;
};

function toAppRole(role: string): AppRole {
  return role in ROLE_LABEL ? (role as AppRole) : "GENERAL";
}

function MenuButtons({
  items,
  activeItem,
  onSelect,
  compact = false,
}: {
  items: MenuItem[];
  activeItem: AppMenuId;
  onSelect: (item: AppMenuId) => void;
  compact?: boolean;
}) {
  return (
    <>
      {items.map((item) => {
        const active = item.id === activeItem;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-lg text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-container/50 ${
              compact
                ? "justify-center px-3"
                : "w-full px-3 text-left"
            } ${
              active
                ? "bg-primary text-on-primary shadow-sm"
                : "text-on-surface-variant hover:bg-primary-fixed/60 hover:text-primary"
            }`}
          >
            <Icon name={item.icon} className="h-5 w-5 shrink-0" />
            <span className={compact ? "sr-only" : undefined}>{item.label}</span>
          </button>
        );
      })}
    </>
  );
}

export function AppSidebar({
  role,
  activeItem,
  userName,
  onSelect,
  onLogout,
}: AppSidebarProps) {
  const appRole = toAppRole(role);
  const items = MENU_ITEMS.filter((item) => item.roles.includes(appRole));

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-outline-variant/40 bg-surface-container-lowest/95 px-4 py-5 shadow-sm backdrop-blur lg:flex">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-on-primary shadow-sm">
            <Icon name="school" className="h-6 w-6" />
          </div>
          <div>
            <p className="font-display text-base font-bold tracking-tight text-primary">
              EvalAI Academic
            </p>
            <p className="text-xs text-on-surface-variant">{ROLE_LABEL[appRole]}</p>
          </div>
        </div>

        <nav aria-label="Navigasi utama" className="mt-9 space-y-1">
          <MenuButtons items={items} activeItem={activeItem} onSelect={onSelect} />
        </nav>

        <div className="mt-auto border-t border-outline-variant/40 pt-4">
          <p className="truncate px-3 text-xs font-medium text-on-surface-variant" title={userName}>
            {userName}
          </p>
          <button
            type="button"
            onClick={onLogout}
            className="mt-3 flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-on-surface-variant outline-none transition-colors hover:bg-error-container hover:text-on-error-container focus-visible:ring-2 focus-visible:ring-error/40"
          >
            <Icon name="logout" className="h-5 w-5" />
            Logout
          </button>
        </div>
      </aside>

      <nav
        aria-label="Navigasi utama"
        className="sticky top-0 z-30 flex min-h-14 items-center justify-between border-b border-outline-variant/40 bg-surface-container-lowest/95 px-3 shadow-sm backdrop-blur lg:hidden"
      >
        <span className="font-display text-sm font-bold text-primary">EvalAI</span>
        <div className="flex items-center gap-1">
          <MenuButtons items={items} activeItem={activeItem} onSelect={onSelect} compact />
          <button
            type="button"
            aria-label="Logout"
            onClick={onLogout}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-on-surface-variant outline-none transition-colors hover:bg-error-container hover:text-on-error-container focus-visible:ring-2 focus-visible:ring-error/40"
          >
            <Icon name="logout" className="h-5 w-5" />
          </button>
        </div>
      </nav>
    </>
  );
}
