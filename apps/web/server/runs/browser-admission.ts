import { PlatformError } from "../projects/platform-store.ts";

/** One synchronous reservation pool shared by runs and generation inspection. */
export class BrowserAdmission {
  private admitted = 0;
  constructor(readonly capacity = 2) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 8)
      throw new Error("Run concurrency must be an integer from 1 to 8");
  }
  acquire(kind: "run" | "inspection") {
    if (this.admitted >= this.capacity)
      throw new PlatformError(
        "adapter_unavailable",
        503,
        kind === "run"
          ? "Run capacity reached; retry after another run or inspection finishes"
          : "Browser capacity reached; wait for the active run or inspection, then generate again",
      );
    this.admitted++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.admitted--;
      }
    };
  }
}
