"use client";

import Link from "next/link";

import { useAuth } from "./components/AuthProvider";

export default function Home() {
  const { user, loading, logout } = useAuth();

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <main className="w-full max-w-2xl text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-white/20 bg-gradient-to-br from-violet-600 to-cyan-500 shadow-lg">
          <span className="text-2xl font-bold text-white">AI</span>
        </div>

        <h1 className="mt-6 bg-gradient-to-r from-violet-300 via-white to-cyan-300 bg-clip-text text-4xl font-semibold tracking-tight text-transparent">
          AI Clinical Misconception
        </h1>
        <p className="mt-3 max-w-lg text-base text-white/60">
          Detect, diagnose and correct clinical misconceptions with intelligent
          assessments.
        </p>

        {loading ? (
          <p className="mt-10 text-white/50">Loading...</p>
        ) : user ? (
          <div className="mt-10 w-full max-w-md rounded-3xl border border-white/20 bg-white/10 px-8 py-7 text-center shadow-2xl backdrop-blur-xl">
            <p className="text-sm text-white/60">Logged in as</p>
            <p className="mt-1.5 text-2xl font-semibold text-white">
              {user.full_name}
            </p>
            <p className="text-sm text-white/60">{user.email}</p>
            <button
              onClick={logout}
              className="mt-6 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 font-medium text-white backdrop-blur-md transition hover:bg-white/20"
            >
              Log out
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="mt-10 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-8 py-3 text-center font-semibold text-white shadow-lg shadow-violet-600/30 transition hover:from-violet-500 hover:to-violet-400 hover:-translate-y-0.5"
          >
            Login
          </Link>
        )}
      </main>
    </div>
  );
}