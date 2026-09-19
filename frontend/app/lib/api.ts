const TOKEN_KEY = "token";

export const getApiBase = () => "/api";

export const getAuthToken = () => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
};

export async function apiFetch<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers);

  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${getApiBase()}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && !endpoint.includes("/auth/login")) {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (typeof window !== "undefined") window.location.href = "/login";
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    let message = "Terjadi kesalahan pada server.";
    if (data && typeof data === "object") {
      if (typeof (data as Record<string, unknown>).detail === "string") {
        message = (data as Record<string, unknown>).detail as string;
      } else if (typeof (data as Record<string, unknown>).error === "string") {
        message = (data as Record<string, unknown>).error as string;
      }
    }
    throw new Error(message);
  }

  return data as T;
}