"use client";

import { useState, type FormEvent } from "react";
import { safeReturnPath } from "./return-path";
import styles from "./auth.module.css";

export function LoginForm({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: fields.get("username"),
          password: fields.get("password"),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? "Sign in failed. Please try again.");
        form.querySelector<HTMLInputElement>('input[name="password"]')?.focus();
        setPending(false);
        return;
      }
      form.reset();
      window.location.replace(safeReturnPath(next));
    } catch {
      setError(
        "Could not reach Veriflow. Check your connection and try again.",
      );
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className={styles.form} aria-label="Sign in">
      <label htmlFor="username">Username</label>
      <input
        id="username"
        name="username"
        autoComplete="username"
        required
        maxLength={256}
        autoCapitalize="none"
        spellCheck={false}
        disabled={pending}
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={1024}
        disabled={pending}
      />
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in to workspace"}
        <span aria-hidden="true">↗</span>
      </button>
      <p className={styles.note}>Use your team account to continue.</p>
    </form>
  );
}
