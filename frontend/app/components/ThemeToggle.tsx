"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

function applyTheme(theme: string) {
  document.documentElement.setAttribute("data-theme", theme);
}

export default function ThemeToggle({ style = {} }: { style?: React.CSSProperties }) {
  const [theme, setTheme] = useState("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      const saved = localStorage.getItem("theme") || "dark";
      setTheme(saved);
      applyTheme(saved);
      setMounted(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    applyTheme(next);
  };

  if (!mounted) {
    return <div style={{ width: "52px", height: "28px", flexShrink: 0 }} />;
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={!isDark}
      title={`Beralih ke mode ${isDark ? "Terang" : "Gelap"}`}
      onClick={toggleTheme}
      style={{
        appearance: "none",
        WebkitAppearance: "none",
        boxSizing: "border-box",
        position: "relative",
        display: "inline-block",
        width: "52px",
        height: "28px",
        minWidth: "52px",
        maxWidth: "52px",
        minHeight: "28px",
        maxHeight: "28px",
        padding: "0",
        margin: "0",
        borderRadius: "9999px",
        background: isDark ? "#1e293b" : "#e2e8f0",
        border: `2px solid ${isDark ? "#475569" : "#cbd5e1"}`,
        cursor: "pointer",
        outline: "none",
        transition: "all 0.25s ease",
        verticalAlign: "middle",
        flexShrink: 0,
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 6px",
          pointerEvents: "none",
        }}
      >
        <Sun size={12} color={isDark ? "#64748b" : "#d97706"} />
        <Moon size={12} color={isDark ? "#818cf8" : "#94a3b8"} />
      </div>
      <div
        style={{
          position: "absolute",
          top: "2px",
          left: isDark ? "24px" : "2px",
          width: "20px",
          height: "20px",
          borderRadius: "50%",
          background: isDark ? "#6366f1" : "#f59e0b",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.3)",
          transition: "left 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s ease",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isDark ? (
          <Moon size={10} color="#ffffff" />
        ) : (
          <Sun size={10} color="#ffffff" />
        )}
      </div>
    </button>
  );
}