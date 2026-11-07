"use client";

import { useState } from "react";
import styles from "./auth.module.css";

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      window.location.replace("/login?signedOut=1");
    } catch {
      setError("Could not sign out. Try again.");
      setPending(false);
    }
  }
  return (
    <div className={styles.logout}>
      <button type="button" onClick={logout} disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
