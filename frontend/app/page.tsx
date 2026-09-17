"use client";

import Link from "next/link";

import { useAuth } from "./components/AuthProvider";

export default function Home() {
  const { user, loading, logout } = useAuth();

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-center py-16 px-16 bg-white dark:bg-black">
        <h1 className="text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
          AI Clinical Misconception
        </h1>

        {loading ? (
          <p className="mt-6 text-zinc-500">Loading...</p>
        ) : user ? (
          <div className="mt-8 w-full max-w-sm rounded-2xl border border-black/10 bg-zinc-50 p-6 text-center dark:border-white/10 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Ingelogd als
            </p>
            <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {user.full_name}
            </p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {user.email}
            </p>
            <button
              onClick={logout}
              className="mt-5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
            >
              Logout
            </button>
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-3">
            <Link
              href="/login"
              className="rounded-lg bg-zinc-900 px-6 py-2 text-center font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
            >
              Login
            </Link>
            <Link
              href="/register"
              className="rounded-lg border border-zinc-300 px-6 py-2 text-center font-medium text-zinc-900 hover:bg-zinc-100 dark:border-white/15 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              Registreren
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}