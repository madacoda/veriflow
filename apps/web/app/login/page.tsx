import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "../../features/auth/login-form";
import { safeReturnPath } from "../../features/auth/return-path";
import {
  authConfig,
  SESSION_COOKIE,
  verifySession,
} from "../../server/auth/session";
import styles from "../../features/auth/auth.module.css";

export const dynamic = "force-dynamic";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; signedOut?: string }>;
}) {
  const query = await searchParams;
  const next = safeReturnPath(query.next);
  let authenticated = false;
  try {
    authenticated = Boolean(
      await verifySession(
        authConfig(),
        (await cookies()).get(SESSION_COOKIE)?.value,
      ),
    );
  } catch {
    /* The form displays the generic configuration error on submission. */
  }
  if (authenticated) redirect(next);
  return (
    <main className={styles.page}>
      <section className={styles.story} aria-label="Veriflow workspace">
        <a className={styles.brand} href="/login">
          <span aria-hidden="true">V/</span> Veriflow
        </a>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>YOUR QUALITY WORKSPACE</p>
          <h1>
            Confidence,
            <br />
            at every step.
          </h1>
          <p>
            Turn intent into testable workflows.
            <br />
            Follow the evidence. Ship with clarity.
          </p>
          <div className={styles.flow} aria-hidden="true">
            <span>01 / Define</span>
            <span>02 / Run</span>
            <span>03 / Verify</span>
          </div>
        </div>
        <p className={styles.footer}>From intent to verified results.</p>
      </section>
      <section className={styles.panel} aria-labelledby="login-title">
        <div className={styles.card}>
          <p className={styles.eyebrow}>TEAM ACCESS</p>
          <h2 id="login-title">Welcome back.</h2>
          <p className={styles.description}>
            Sign in to your Veriflow workspace.
          </p>
          {query.signedOut === "1" && (
            <p className={styles.notice} role="status">
              You have been signed out.
            </p>
          )}
          <LoginForm next={next} />
        </div>
      </section>
    </main>
  );
}
