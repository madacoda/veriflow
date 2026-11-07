import { request, type FullConfig } from "@playwright/test";
import { unlink } from "node:fs/promises";
import { authFixtureEnv } from "./auth-fixture.ts";

export default async function setup(config: FullConfig) {
  const origin = config.projects[0].use.baseURL!;
  const client = await request.newContext({ baseURL: origin });
  try {
    const response = await client.post("/api/auth/login", {
      headers: { Origin: origin },
      data: {
        username: authFixtureEnv.AUTH_USERNAME,
        password: authFixtureEnv.AUTH_PASSWORD,
      },
    });
    if (response.status() !== 200) {
      const code = (await response.json()).error?.code;
      throw new Error(
        `Smoke fixture sign-in failed: HTTP ${response.status()} (${code})`,
      );
    }
    const state = await client.storageState({
      path: process.env.VERIFLOW_AUTH_STATE!,
    });
    process.env.VERIFLOW_TEST_SESSION = state.cookies.find(
      (cookie) => cookie.name === "veriflow_session",
    )!.value;
  } finally {
    await client.dispose();
  }
  return async () => {
    await unlink(process.env.VERIFLOW_AUTH_STATE!).catch(() => {});
  };
}
