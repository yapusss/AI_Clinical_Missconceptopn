"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "../components/AuthProvider";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login(email, password);
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-3xl border border-white/20 bg-white/10 px-8 py-9 shadow-2xl backdrop-blur-xl"
      >
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/20 bg-gradient-to-br from-violet-600 to-cyan-500 shadow-lg">
            <span className="text-xl font-bold text-white">AI</span>
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-white">Welcome back</h1>
          <p className="mt-1 text-sm text-white/60">
            Log in to your AI Clinical account.
          </p>
        </div>

        <label className="mt-7 block text-sm font-medium text-white/80">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1.5 block w-full rounded-xl border border-white/15 bg-white/10 px-3.5 py-2.5 text-white placeholder:text-white/35 backdrop-blur-md transition focus:border-violet-400 focus:bg-white/15 focus:ring-2 focus:ring-violet-400/40"
          />
        </label>

        <label className="mt-4 block text-sm font-medium text-white/80">
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="mt-1.5 block w-full rounded-xl border border-white/15 bg-white/10 px-3.5 py-2.5 text-white placeholder:text-white/35 backdrop-blur-md transition focus:border-violet-400 focus:bg-white/15 focus:ring-2 focus:ring-violet-400/40"
          />
        </label>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-red-400/30 bg-red-500/15 px-3.5 py-2.5 text-sm text-red-300 backdrop-blur-md"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-4 py-2.5 font-semibold text-white shadow-lg shadow-violet-600/30 transition hover:from-violet-500 hover:to-violet-400 hover:-translate-y-0.5 disabled:opacity-60"
        >
          {submitting ? "Logging in..." : "Login"}
        </button>

        <p className="mt-5 text-center text-sm text-white/60">
          No account yet?{" "}
          <Link
            href="/register"
            className="font-medium text-violet-300 underline-offset-2 hover:text-violet-200"
          >
            Create one
          </Link>
        </p>
      </form>
    </main>
  );
}