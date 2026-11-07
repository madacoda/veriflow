import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** Synthetic target for grounded-generation contracts; no model or external account. */
export async function startGenerationContextTarget() {
  let mutations = 0;
  const server = createServer((request, response) => {
    if (request.method !== "GET") mutations++;
    const path = new URL(request.url ?? "/", "http://fixture.local").pathname;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    if (path === "/slow") {
      const timer = setTimeout(() => response.end("Delayed fixture"), 10000);
      request.on("close", () => clearTimeout(timer));
      return;
    }
    if (path === "/unavailable") {
      response.statusCode = 503;
      response.end("Fixture unavailable");
      return;
    }
    const content: Record<string, string> = {
      "/unique": `<main><h1>Checkout fixture</h1><label for="coupon">Coupon</label><input id="coupon" data-testid="coupon-input"><button onclick="document.querySelector('[role=status]').textContent='Applied'">Apply coupon</button><p role="status" aria-label="Coupon result">Not applied</p><a href="/public">Arena</a></main>`,
      "/ambiguous": `<main><h1>Duplicate fixture</h1><button onclick="window.clicks++">Buy item</button><button onclick="window.clicks++">Buy item</button></main><script>window.clicks=0</script>`,
      "/guarded": `<main><h1>Player account required</h1><p>Sign in to access the Battle Arena and deploy your squad.</p><button>Sign in / Register</button></main>`,
      "/public": `<aside><h2>Player features locked</h2><p>Sign in to unlock your account.</p><button>Guest Login</button></aside><main><h1>Dreamweaver Arena</h1><p>Public arena preview</p><button>View opponents</button></main>`,
      "/dialog": `<main><h1>Battle</h1></main><dialog open aria-label="Sign in"><label for="email">Email</label><input id="email"><label for="password">Password</label><input id="password" type="password"><button>Sign in</button></dialog>`,
    };
    response.end(
      `<!doctype html><html lang="en"><head><title>Generation context fixture</title></head><body>${content[path] ?? content["/unique"]}</body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    mutations: () => mutations,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
