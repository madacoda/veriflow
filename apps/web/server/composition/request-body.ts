import { PlatformError } from "../projects/platform-store.ts";

/** Enforce limits on streamed bodies as well as requests without Content-Length. */
export async function readRequestBody(
  request: Request,
  limit: number,
  signal = request.signal,
): Promise<Uint8Array> {
  signal.throwIfAborted();
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  let length = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) {
        void reader.cancel().catch(() => {});
        throw new PlatformError(
          "payload_too_large",
          413,
          "Request body exceeds the size limit",
        );
      }
      parts.push(chunk.value);
    }
    return new Uint8Array(Buffer.concat(parts));
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
