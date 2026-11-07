import { PlatformError } from "../projects/platform-store.ts";

/** Enforce limits on streamed bodies as well as requests without Content-Length. */
export async function readRequestBody(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let length = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) {
        await reader.cancel();
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
    reader.releaseLock();
  }
}
