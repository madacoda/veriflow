import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** Independent Dev 3 fixture. No shared workflow contracts or app ports required. */
export async function startBrowserTarget() {
  let requestCount = 0;
  const server = createServer((request, response) => {
    requestCount += 1;
    const url = new URL(request.url ?? "/", "http://fixture.local");
    response.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/redirect") {
      response.writeHead(302, {
        Location: url.searchParams.get("to") ?? "/demo",
      });
      response.end();
      return;
    }
    if (url.pathname !== "/demo") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const total = url.searchParams.get("bug") === "1" ? "100000" : "90000";
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html>
<html lang="en"><head><title>Dev 3 coupon fixture</title></head>
<body><main><h1>Coupon checkout</h1>
<label for="coupon">Coupon</label>
<input id="coupon" data-testid="coupon-input" autocomplete="off">
<input data-testid="disabled" disabled aria-label="Disabled field">
<button data-testid="apply-coupon" type="button">Apply coupon</button>
<button data-testid="navigate" type="button">Navigate</button>
<button data-testid="popup" type="button">Open popup</button>
<p>Total <span data-testid="order-total">100000</span></p>
<label><input type="checkbox" data-testid="terms">Accept terms</label>
<p data-testid="status" role="status"></p>
</main><script>
document.querySelector('[data-testid="apply-coupon"]').addEventListener('click', () => {
  const valid = document.querySelector('#coupon').value === 'SAVE10';
  const delay = new URL(location.href).searchParams.get('delayed') === '1' ? 150 : 0;
  setTimeout(() => { document.querySelector('[data-testid="order-total"]').textContent = valid ? '${total}' : '100000'; }, delay);
  document.querySelector('[data-testid="status"]').textContent = valid ? 'Coupon applied' : 'Unknown coupon';
});
document.querySelector('[data-testid="navigate"]').addEventListener('click', () => {
  const to = new URL(location.href).searchParams.get('to');
  if (to) location.assign(to);
});
document.querySelector('[data-testid="popup"]').addEventListener('click', () => {
  const to = new URL(location.href).searchParams.get('to');
  if (to) window.open(to);
});
if (new URL(location.href).searchParams.get('delayed') === '1') {
  setTimeout(() => {
    const input = document.createElement('input'); input.setAttribute('data-testid', 'late'); document.body.append(input);
  }, 150);
}
</script></body></html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let closing: Promise<void> | undefined;
  return {
    origin,
    requests: () => requestCount,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
