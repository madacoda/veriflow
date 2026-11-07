import Fastify from "fastify";
import { registerHealthRoutes } from "./platform/http/health.js";

// Composition root. Register module public entry points here as they are developed.
export function createApp() {
  const app = Fastify({ logger: true });
  registerHealthRoutes(app);
  return app;
}
