"use client";

import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";

import { useAuth } from "./components/AuthProvider";
import ThemeToggle from "./components/ThemeToggle";

export default function Home() {
  const { user, loading } = useAuth();

  return (
    <div
      className="app-shell"
      style={{
        minHeight: "100vh",
        background: "var(--bg-main)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ position: "absolute", top: "16px", right: "16px" }}>
        <ThemeToggle />
      </div>

      <div
        className="glass-panel animate-fade-in"
        style={{
          width: "100%",
          maxWidth: "560px",
          padding: "2.5rem",
          borderRadius: "var(--radius-lg)",
          textAlign: "center",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "var(--radius-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--gradient-primary)",
            color: "#ffffff",
            margin: "0 auto",
          }}
        >
          <Building2 size={34} />
        </div>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, letterSpacing: "-0.02em", margin: "1rem 0 0.4rem" }}>
          AI Clinical Misconception
        </h1>
        <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", maxWidth: "440px", margin: "0 auto" }}>
          Detect, diagnose and correct clinical misconceptions with intelligent assessments.
        </p>

        {loading ? (
          <p style={{ color: "var(--text-dim)", fontSize: "0.85rem", marginTop: "1.5rem" }}>Memproses...</p>
        ) : user ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1.5rem" }}>
            <Link href="/select-role" className="btn-primary" style={{ width: "100%", padding: "0.75rem 1.25rem" }}>
              Buka Dashboard
              <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <Link href="/login" className="btn-primary" style={{ width: "100%", padding: "0.75rem 1.25rem", marginTop: "1.5rem" }}>
            Login
            <ArrowRight size={16} />
          </Link>
        )}
      </div>
    </div>
  );
}