/** Public, explicit test credentials. Never read developer .env credentials. */
export const authFixtureEnv = {
  AUTH_USERNAME: "smoke-operator",
  AUTH_PASSWORD: "fixture-password-only",
  AUTH_SESSION_SECRET: "explicit-smoke-fixture-session-secret-32-chars",
  AUTH_COOKIE_SECURE: "false",
  AUTH_ORIGIN: "",
};
export function fixtureHeaders(origin: string) {
  const token = process.env.VERIFLOW_TEST_SESSION;
  if (!token) throw new Error("Smoke authentication setup has not run");
  return { Cookie: `veriflow_session=${token}`, Origin: origin };
}
