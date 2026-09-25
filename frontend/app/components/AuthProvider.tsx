"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";

export type RoleInfo = {
  role: string;
  subject_slug: string | null;
  subject_name: string | null;
};

export type User = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_superuser: boolean;
  created_at?: string;
  roles?: RoleInfo[];
};

type AuthContextType = {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  register: (fullName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);
const TOKEN_KEY = "token";

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

function storeToken(token: string, remember: boolean) {
  const target = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  other.removeItem(TOKEN_KEY);
  target.setItem(TOKEN_KEY, token);
}

function clearStoredToken() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

async function parseError(res: Response): Promise<string> {
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    return "Server error, try again later.";
  }
  if (typeof data.detail === "string") return data.detail;
  for (const value of Object.values(data)) {
    if (Array.isArray(value) && value.length > 0) return String(value[0]);
  }
  return "Something went wrong.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // SSR-stable: the server must render the same thing as the first client pass.
  // The stored token is read after mount; `loading` blocks the auth guard until then.
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const stored = readStoredToken();
    if (stored) setToken(stored);
    else setLoading(false);
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("unauthorized");
        return res.json();
      })
      .then((data: User) => {
        if (!cancelled) {
          setUser(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearStoredToken();
          setToken(null);
          setUser(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(
    async (email: string, password: string, remember = true) => {
      let res: Response;
      try {
        res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
      } catch {
        throw new Error(
          "Tidak dapat menghubungi server. Pastikan layanan backend sedang berjalan.",
        );
      }
      if (!res.ok) throw new Error(await parseError(res));
      const data = (await res.json()) as { token: string; user: User };
      storeToken(data.token, remember);
      setToken(data.token);
      setUser(data.user);
      setLoading(false);
    },
    [],
  );

  const register = useCallback(
    async (fullName: string, email: string, password: string) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, email, password }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      const data = (await res.json()) as { token: string; user: User };
      storeToken(data.token, true);
      setToken(data.token);
      setUser(data.user);
      setLoading(false);
    },
    [],
  );

  const logout = useCallback(async () => {
    if (token) {
      try {
        await fetch("/api/auth/me", {
          method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Local session is still cleared when the server is unavailable.
      }
    }
    clearStoredToken();
    setToken(null);
    setUser(null);
    setLoading(false);
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
