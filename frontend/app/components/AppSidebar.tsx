"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  Building2,
  ClipboardList,
  FileSearch,
  CircleHelp,
  BarChart3,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";

import { useAuth } from "./AuthProvider";
import ThemeToggle from "./ThemeToggle";
import Breadcrumb from "./Breadcrumb";

type AppRole = "ADMIN" | "LECTURER" | "STUDENT" | "GENERAL";

type MenuItem = {
  label: string;
  path: string;
  icon: typeof LayoutDashboard;
  roles: AppRole[];
};

const ROLE_LABEL: Record<AppRole, string> = {
  ADMIN: "Administrator",
  LECTURER: "Dosen",
  STUDENT: "Mahasiswa",
  GENERAL: "Akun umum",
};

const MENU_ITEMS: MenuItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard, roles: ["ADMIN", "LECTURER", "STUDENT", "GENERAL"] },
  { label: "Soal", path: "/code", icon: ClipboardList, roles: ["STUDENT"] },
  { label: "Soal", path: "/questions", icon: FileSearch, roles: ["ADMIN", "LECTURER"] },
  { label: "Mata Kuliah", path: "/admin/subjects", icon: BookOpen, roles: ["LECTURER"] },
  { label: "Jawaban Mahasiswa", path: "/submissions", icon: ClipboardList, roles: ["ADMIN", "LECTURER"] },
  { label: "Validasi", path: "/validation", icon: ShieldCheck, roles: ["ADMIN", "LECTURER"] },
  { label: "Metrik AI", path: "/metrics", icon: BarChart3, roles: ["ADMIN", "LECTURER"] },
  { label: "Settings", path: "/settings", icon: Settings, roles: ["ADMIN"] },
  { label: "Kelola Mata Kuliah", path: "/admin/subjects", icon: BookOpen, roles: ["ADMIN"] },
  { label: "Kelola Dosen", path: "/admin/lecturers", icon: UserRound, roles: ["ADMIN"] },
  { label: "Kelola Mahasiswa", path: "/admin/students", icon: GraduationCap, roles: ["ADMIN"] },
  { label: "Profile", path: "/profile", icon: UserRound, roles: ["ADMIN", "LECTURER", "STUDENT", "GENERAL"] },
  { label: "Pusat Bantuan", path: "/help", icon: CircleHelp, roles: ["ADMIN"] },
  { label: "Bantuan", path: "/help", icon: CircleHelp, roles: ["LECTURER", "STUDENT", "GENERAL"] },
];

function toAppRole(role?: string): AppRole {
  return role === "ADMIN" || role === "LECTURER" || role === "STUDENT" ? role : "GENERAL";
}

export default function AppSidebar({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  // Must start false on the server AND on the first client render (hydration),
  // then flip in an effect â€” see React's two-pass pattern. Diverging here causes
  // a hydration mismatch and a client-side re-render of the whole shell.
  const [mounted, setMounted] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [currentSearch, setCurrentSearch] = useState("");
  const [selectedRole, setSelectedRole] = useState<AppRole | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    setCurrentSearch(window.location.search);
    const storedRole = window.localStorage.getItem("selected_role");
    if (storedRole) setSelectedRole(toAppRole(storedRole));
  }, [pathname]);

  const isPublic = pathname === "/" || pathname === "/login" || pathname === "/select-role";

  if (isPublic) {
    return <>{children}</>;
  }

  if (!mounted || loading) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-main)" }}>
        <div style={{ flex: 1, padding: "24px 32px" }} />
      </div>
    );
  }

  if (!user) return null;

  const fallbackRole = user.is_superuser ? "ADMIN" : toAppRole(user.roles?.[0]?.role);
  const appRole = user.is_superuser ? "ADMIN" : selectedRole ?? fallbackRole;
  const items = MENU_ITEMS.filter((item) => item.roles.includes(appRole));

  // set by an effect (below) so the first client render matches the server

  const isActive = (path: string) => {
    if (path === "/dashboard") {
      const hasView = new URLSearchParams(currentSearch).has("view");
      return pathname.startsWith("/dashboard") && !hasView;
    }
    if (path.startsWith("/dashboard?")) {
      const target = new URLSearchParams(path.split("?")[1]).get("view");
      return new URLSearchParams(currentSearch).get("view") === target;
    }
    return pathname === path || (path === "/admin/subjects" && pathname.startsWith("/admin/subjects/"));
  };

  const handleLogout = () => {
    setMobileNavOpen(false);
    void logout().then(() => router.replace("/login"));
  };

  return (
    <div className="app-shell" style={{ display: "flex", minHeight: "100vh", background: "var(--bg-main)" }}>
      <header className="mobile-app-header glass-panel">
        <div className="mobile-app-brand">
          <Building2 size={22} color="var(--primary)" />
          <div>
            <strong>EvalAI Academic</strong>
            <span>AI Clinical Misconception</span>
          </div>
        </div>
        <button
          type="button"
          className="mobile-menu-button"
          onClick={() => setMobileNavOpen((isOpen) => !isOpen)}
          aria-expanded={mobileNavOpen}
          aria-label={mobileNavOpen ? "Tutup menu navigasi" : "Buka menu navigasi"}
        >
          {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      {mobileNavOpen && (
        <button
          type="button"
          className="mobile-nav-overlay"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Tutup menu navigasi"
        />
      )}

      <aside className={`glass-panel app-sidebar ${mobileNavOpen ? "app-sidebar-open" : ""}`}>
        <div>
          <div
            style={{
              paddingBottom: "14px",
              borderBottom: "1px solid var(--border-color)",
              marginBottom: "14px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <Building2 size={24} color="var(--primary)" style={{ flexShrink: 0 }} />
            <div>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 800, letterSpacing: "-0.4px", color: "var(--text-main)", margin: 0, lineHeight: 1.2 }}>
                EvalAI Academic
              </h2>
              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginTop: "2px" }}>
                AI Clinical Misconception
              </span>
            </div>
          </div>

          <nav style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            {items.map((item) => {
              const active = isActive(item.path);
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={() => setMobileNavOpen(false)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    color: active ? "#ffffff" : "var(--text-muted)",
                    background: active ? "var(--gradient-primary)" : "transparent",
                    textDecoration: "none",
                    fontSize: "0.825rem",
                    fontWeight: active ? "600" : "500",
                    transition: "all 0.15s ease",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <Icon size={16} color={active ? "#ffffff" : "var(--text-muted)"} style={{ flexShrink: 0 }} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div
          style={{
            paddingTop: "12px",
            borderTop: "1px solid var(--border-color)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div
            style={{
              padding: "8px 10px",
              background: "var(--input-bg)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-color)",
            }}
          >
            <div style={{ fontWeight: 700, color: "var(--text-main)", fontSize: "0.8rem" }}>
              {user.full_name}
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "2px" }}>
              Peran: <strong style={{ color: "var(--primary)" }}>{ROLE_LABEL[appRole]}</strong>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 12px",
              background: "var(--input-bg)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-color)",
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600 }}>
              Mode Tampilan
            </span>
            <div style={{ display: "flex", alignItems: "center", marginLeft: "auto" }}>
              <ThemeToggle />
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            style={{
              width: "100%",
              padding: "8px 12px",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              borderRadius: "var(--radius-sm)",
              color: "#ef4444",
              fontSize: "0.825rem",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              transition: "all 0.15s ease",
            }}
          >
            <LogOut size={16} />
            Keluar Sistem
          </button>
        </div>
      </aside>

      <main className="app-main">
        <Breadcrumb />
        {children}
      </main>
    </div>
  );
}
