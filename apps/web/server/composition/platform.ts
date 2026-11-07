import { resolve } from "node:path";
import type { SessionFactory } from "@veriflow/core";
import { PlatformStore } from "../projects/platform-store.ts";
import { RunCoordinator } from "../runs/coordinator.ts";
import { createFakeSessionFactory } from "../runs/fake-session.ts";
import { PlatformHttp, errorResponse } from "./http.ts";

export async function createPlatform(
  storageRoot: string,
  factory?: SessionFactory,
  adapter: "browser" | "fake" = "browser",
) {
  const store = new PlatformStore(storageRoot);
  await store.recoverInterruptedRuns();
  const coordinator = new RunCoordinator(store, factory, adapter);
  return { store, coordinator, http: new PlatformHttp(store, coordinator) };
}
const processState = globalThis as typeof globalThis & {
  __veriflowPlatform?: ReturnType<typeof createPlatform>;
};
export async function platformHttp() {
  if (!processState.__veriflowPlatform) {
    const fake = process.env.VERIFLOW_RUN_ADAPTER === "fake";
    // Dev 1 wires Dev 3's real SessionFactory here after its reviewed B1 PR lands.
    const factory = fake
      ? createFakeSessionFactory(
          process.env.VERIFLOW_FAKE_OUTCOME === "failed" ? "failed" : "passed",
        )
      : undefined;
    const pending = createPlatform(
      // Persistent runtime data lives on its own volume and must not be bundled.
      resolve(
        /* turbopackIgnore: true */ process.env.STORAGE_DIR ?? "../../data",
      ),
      factory,
      fake ? "fake" : "browser",
    );
    processState.__veriflowPlatform = pending;
    pending.catch(() => {
      if (processState.__veriflowPlatform === pending)
        delete processState.__veriflowPlatform;
    });
  }
  return (await processState.__veriflowPlatform).http;
}
export async function platformRoute(
  action: (http: PlatformHttp) => Promise<Response>,
) {
  try {
    return await action(await platformHttp());
  } catch (error) {
    return errorResponse(error);
  }
}
