"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import styles from "@/app/admin/admin.module.css";

type Mode = "login" | "register";

export default function AdminAuthPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [status, setStatus] = useState<{ type: "error" | "success"; message: string } | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  const update = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload =
        mode === "login"
          ? { email: form.email, password: form.password }
          : { name: form.name, email: form.email, password: form.password };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({ type: "error", message: data.error || "Login failed." });
        return;
      }
      setStatus({
        type: "success",
        message: mode === "login" ? "Welcome back." : "Account created.",
      });
      const redirectTo = params?.get("from") || "/admin";
      // Force full reload to ensure RootLayout picks up the new cookie
      window.location.href = redirectTo;
    } catch (error) {
      setStatus({ type: "error", message: "Something went wrong. Try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`card ${styles.authCard}`}>
      <div className={styles.authTabs}>
        <button
          type="button"
          className={`${styles.authTab} ${mode === "login" ? styles.authTabActive : ""}`}
          onClick={() => setMode("login")}
        >
          Login
        </button>
        <button
          type="button"
          className={`${styles.authTab} ${mode === "register" ? styles.authTabActive : ""}`}
          onClick={() => setMode("register")}
        >
          Register
        </button>
      </div>
      <div className={styles.authForm}>
        {mode === "register" ? (
          <input
            className="search-input"
            placeholder="Full name"
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
          />
        ) : null}
        <input
          className="search-input"
          placeholder="Email (@suhradsportsclub.ca)"
          value={form.email}
          onChange={(event) => update("email", event.target.value)}
        />
        <input
          className="search-input"
          placeholder="Password"
          type="password"
          value={form.password}
          onChange={(event) => update("password", event.target.value)}
        />
        {status ? (
          <span className={status.type === "error" ? styles.authError : styles.authSuccess}>
            {status.message}
          </span>
        ) : null}
        <button className="pill" type="button" onClick={submit} disabled={loading}>
          {loading ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
        </button>
      </div>
    </div>
  );
}
