"use client";

import { useEffect, useState } from "react";
import {
  CircleCheck,
  CircleStop,
  Eye,
  KeyRound,
  Pencil,
  UserRound,
  Users,
  X,
} from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import AppMultiSelect from "./AppMultiSelect";
import ListToolbar from "./ListToolbar";
import PageContainer from "./PageContainer";
import PageHeader from "./PageHeader";

type Subject = { id: string; name: string };
type ManagedUser = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  created_at: string;
  subjects: Subject[];
};

export default function AdminUserManagement({
  role,
  title,
  description,
  token,
}: {
  role: "lecturers" | "students";
  title: string;
  description: string;
  token: string;
}) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [viewing, setViewing] = useState<ManagedUser | null>(null);
  const [pendingDeactivate, setPendingDeactivate] =
    useState<ManagedUser | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    subject_ids: [] as string[],
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [userResponse, subjectResponse] = await Promise.all([
      fetch(`/api/admin/users/${role}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch("/api/admin/subjects", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);
    if (!userResponse.ok || !subjectResponse.ok)
      throw new Error("Gagal memuat data akun.");
    setUsers(await userResponse.json());
    setSubjects(await subjectResponse.json());
  }

  useEffect(() => {
    void load().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Gagal memuat data."),
    );
  }, [role, token]);

  function openCreate() {
    setEditing(null);
    setForm({ full_name: "", email: "", password: "", subject_ids: [] });
    setShowForm(true);
    setError("");
  }
  function openEdit(user: ManagedUser) {
    setEditing(user);
    setForm({
      full_name: user.full_name,
      email: user.email,
      password: "",
      subject_ids: user.subjects.map((subject) => subject.id),
    });
    setShowForm(true);
    setError("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        editing
          ? `/api/admin/users/${role}/${editing.id}`
          : `/api/admin/users/${role}`,
        {
          method: editing ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            ...form,
            ...(editing ? {} : { is_active: true }),
          }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.detail ||
            Object.values(data).flat().join(" ") ||
            "Gagal menyimpan akun.",
        );
      setNotice(
        editing ? "Akun berhasil diperbarui." : "Akun berhasil dibuat.",
      );
      setEditing(null);
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Gagal menyimpan akun.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function performToggleActive(user: ManagedUser) {
    const response = await fetch(`/api/admin/users/${role}/${user.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ is_active: !user.is_active }),
    });
    if (!response.ok) {
      setError("Status akun gagal diperbarui.");
      return;
    }
    setNotice(user.is_active ? "Akun dinonaktifkan." : "Akun diaktifkan.");
    await load();
  }

  function toggleActive(user: ManagedUser) {
    if (user.is_active) {
      setPendingDeactivate(user);
      return;
    }
    void performToggleActive(user);
  }

  const visible = users.filter((user) =>
    `${user.full_name} ${user.email}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const roleLabel = role === "lecturers" ? "Dosen" : "Mahasiswa";

  return (
    <PageContainer>
      <PageHeader title={title} description={description} icon={Users} />
      {error && (
        <div
          role="alert"
          className="mt-5 rounded-lg border border-error/40 bg-error-container p-3 text-sm text-on-error-container"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="mt-5 rounded-lg border border-primary-fixed-dim bg-primary-fixed/50 p-3 text-sm text-primary"
        >
          {notice}
        </div>
      )}
      <div className="mt-6">
        <ListToolbar
          addLabel="Tambah akun"
          onAdd={openCreate}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Cari nama atau email..."
        />
      </div>
      <div className="mt-5 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-outline-variant/40 bg-surface-container-low text-on-surface-variant">
            <tr>
              <th className="px-5 py-4">Nama</th>
              <th className="px-5 py-4">Email</th>
              <th className="px-5 py-4">Mata kuliah</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/30">
            {visible.map((user) => (
              <tr key={user.id}>
                <td className="px-5 py-4 font-semibold text-on-surface">
                  {user.full_name}
                </td>
                <td className="px-5 py-4 text-on-surface-variant">
                  {user.email}
                </td>
                <td className="px-5 py-4 text-on-surface-variant">
                  {user.subjects.length
                    ? user.subjects.map((subject) => subject.name).join(", ")
                    : "Belum ditentukan"}
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`badge ${user.is_active ? "badge-active" : "badge-revoked"}`}
                  >
                    {user.is_active ? "Aktif" : "Nonaktif"}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setViewing(user)}
                      className="btn-secondary table-action-button"
                      aria-label={`Lihat detail ${user.full_name}`}
                      title="Lihat detail"
                    >
                      <Eye
                        size={18}
                        stroke="#4f46e5"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(user)}
                      className="btn-secondary table-action-button"
                      aria-label={`Edit ${user.full_name}`}
                      title="Edit akun"
                    >
                      <Pencil
                        size={18}
                        stroke="#4f46e5"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleActive(user)}
                      className="btn-secondary table-action-button"
                      aria-label={
                        user.is_active
                          ? `Nonaktifkan ${user.full_name}`
                          : `Aktifkan ${user.full_name}`
                      }
                      title={
                        user.is_active ? "Nonaktifkan akun" : "Aktifkan akun"
                      }
                    >
                      {user.is_active ? (
                        <CircleStop
                          size={18}
                          stroke="#dc2626"
                          strokeWidth={2.5}
                          aria-hidden="true"
                        />
                      ) : (
                        <CircleCheck
                          size={18}
                          stroke="#059669"
                          strokeWidth={2.5}
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && (
          <p className="p-10 text-center text-sm text-on-surface-variant">
            Belum ada akun.
          </p>
        )}
      </div>
      {viewing && (
        <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 p-4">
          <div className="my-8 w-full max-w-xl rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-outline-variant/30 pb-4">
              <div>
                <h2 className="font-display text-xl font-bold text-on-surface">
                  {viewing.full_name}
                </h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  Detail akun {roleLabel.toLowerCase()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewing(null)}
                aria-label="Tutup detail"
                className="text-on-surface-variant"
              >
                <X size={20} />
              </button>
            </div>
            <dl className="mt-5 space-y-4 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase text-on-surface-variant">
                  Email
                </dt>
                <dd className="mt-1 text-on-surface">{viewing.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-on-surface-variant">
                  Status
                </dt>
                <dd className="mt-1">
                  <span
                    className={`badge ${viewing.is_active ? "badge-active" : "badge-revoked"}`}
                  >
                    {viewing.is_active ? "Aktif" : "Nonaktif"}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-on-surface-variant">
                  Mata kuliah
                </dt>
                <dd className="mt-2 flex flex-wrap gap-2">
                  {viewing.subjects.length ? (
                    viewing.subjects.map((subject) => (
                      <span key={subject.id} className="badge badge-role">
                        {subject.name}
                      </span>
                    ))
                  ) : (
                    <span className="text-on-surface-variant">
                      Belum ditetapkan
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!pendingDeactivate}
        title={`Nonaktifkan akun ${roleLabel.toLowerCase()}?`}
        description={`Akun ${pendingDeactivate?.full_name ?? "ini"} tidak dapat masuk sampai diaktifkan kembali.`}
        confirmLabel="Nonaktifkan"
        onCancel={() => setPendingDeactivate(null)}
        onConfirm={() => {
          if (pendingDeactivate) void performToggleActive(pendingDeactivate);
          setPendingDeactivate(null);
        }}
      />
      {showForm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={submit}
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl"
          >
            <header className="flex shrink-0 items-start gap-3 border-b border-outline-variant/30 px-5 py-4 sm:px-6 sm:py-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-primary">
                <UserRound size={20} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-xl font-bold leading-6 text-on-surface">
                  {editing ? "Edit akun" : "Tambah akun"} {roleLabel}
                </h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  {editing
                    ? `Perbarui informasi akun ${roleLabel.toLowerCase()}.`
                    : `Lengkapi informasi untuk membuat akun ${roleLabel.toLowerCase()} baru.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                aria-label="Tutup formulir"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>
            <div className="min-h-0 overflow-y-auto px-5 py-3 sm:px-6 sm:py-3">
              <div className="space-y-3">
                <section className="rounded-xl border border-outline-variant/50 p-4">
                  <div className="mb-3 flex items-center gap-2 text-base font-semibold text-on-surface">
                    <UserRound
                      size={18}
                      className="text-primary"
                      aria-hidden="true"
                    />
                    Informasi akun
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="account-full-name"
                        className="mb-1.5 block text-sm font-medium text-on-surface-variant"
                      >
                        Nama lengkap
                      </label>
                      <input
                        id="account-full-name"
                        value={form.full_name}
                        onChange={(event) =>
                          setForm({ ...form, full_name: event.target.value })
                        }
                        required
                        placeholder="Masukkan nama lengkap"
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="account-email"
                        className="mb-1.5 block text-sm font-medium text-on-surface-variant"
                      >
                        Email
                      </label>
                      <input
                        id="account-email"
                        type="email"
                        value={form.email}
                        onChange={(event) =>
                          setForm({ ...form, email: event.target.value })
                        }
                        required
                        placeholder="nama@kampus.ac.id"
                        className="form-input"
                      />
                    </div>
                  </div>
                </section>
                <section className="rounded-xl border border-outline-variant/50 p-4">
                  <div className="mb-3 flex items-center gap-2 text-base font-semibold text-on-surface">
                    <KeyRound
                      size={18}
                      className="text-primary"
                      aria-hidden="true"
                    />
                    Keamanan & Penugasan mata kuliah
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                    <label
                      htmlFor="account-password"
                      className="mb-1.5 block text-sm font-medium text-on-surface-variant"
                    >
                      Password{editing && " baru"}
                    </label>
                    <input
                      id="account-password"
                      type="password"
                      value={form.password}
                      onChange={(event) =>
                        setForm({ ...form, password: event.target.value })
                      }
                      required={!editing}
                      placeholder={
                        editing
                          ? "Kosongkan jika tidak ingin mengubah password"
                          : "Minimal 8 karakter"
                      }
                      className="form-input"
                    />
                    </div>
                    <div>
                    <label className="mb-1.5 block text-sm font-medium text-on-surface-variant">
                      Mata kuliah
                    </label>
                    <AppMultiSelect
                      value={form.subject_ids}
                      onValueChange={(subject_ids) =>
                        setForm((current) => ({ ...current, subject_ids }))
                      }
                      options={subjects.map((subject) => ({
                        value: subject.id,
                        label: subject.name,
                      }))}
                      placeholder="Pilih mata kuliah"
                      ariaLabel="Pilih mata kuliah"
                      clearLabel="Hapus semua mata kuliah yang dipilih"
                      selectedCountLabel="mata kuliah dipilih"
                    />
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <footer className="flex shrink-0 flex-col-reverse gap-3 border-t border-outline-variant/30 bg-surface-container-low px-5 py-3 sm:flex-row sm:justify-end sm:px-6 sm:py-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn-secondary w-full sm:w-auto"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={busy}
                className="btn-primary w-full sm:w-auto"
              >
                {busy ? "Menyimpan..." : "Simpan akun"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </PageContainer>
  );
}
