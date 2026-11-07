import { createApp } from "./app.js";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const app = createApp();

try {
  await mkdir(resolve(process.env.STORAGE_DIR ?? "../../data"), {
    recursive: true,
  });
  await app.listen({
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 4000),
  });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
  });
}
