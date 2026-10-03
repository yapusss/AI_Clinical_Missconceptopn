export async function uploadFile(file: File): Promise<string> {
  const token = localStorage.getItem("token") ?? sessionStorage.getItem("token");
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/uploads", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.url) {
    throw new Error(data.detail || "Gagal mengunggah gambar.");
  }
  return data.url as string;
}
