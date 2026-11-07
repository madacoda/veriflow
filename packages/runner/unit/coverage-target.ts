import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** Deterministic target application fixture. All interactions use real Chromium and HTTP. */
export async function startCoverageTarget() {
  let buggy = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture.local");
    res.setHeader("Cache-Control", "no-store");
    const signedIn = req.headers.cookie?.includes("fixture-session=member");
    if (url.pathname === "/login") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      if (
        form.get("username") === "fixture-user" &&
        form.get("password") === "fixture-password"
      ) {
        res.setHeader(
          "Set-Cookie",
          "fixture-session=member; HttpOnly; SameSite=Strict; Path=/",
        );
        res.writeHead(303, { Location: "/" });
        res.end();
        return;
      }
      res.writeHead(401);
      res.end("Invalid sign in");
      return;
    }
    if (url.pathname === "/private" || url.pathname === "/admin") {
      res.writeHead(signedIn ? (url.pathname === "/admin" ? 403 : 200) : 401, {
        "Content-Type": "text/html",
      });
      res.end(
        "<!doctype html><html lang='en'><title>Access</title><main><h1>Access response</h1></main></html>",
      );
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html lang="en"><head><title>Coverage fixture</title><style>body{font:18px sans-serif;color:#111;background:white;margin:16px}main{max-width:700px}input,button{display:block;margin:8px 0;max-width:100%;box-sizing:border-box} ${url.searchParams.has("overflow") ? "main{width:2000px;max-width:none}" : ""}</style></head><body><main>
<h1>Coverage target fixture</h1>
<form action="/login" method="post"><label for="username">Username</label><input id="username" name="username" data-testid="username" autocomplete="username"><label for="password">Password</label><input id="password" name="password" data-testid="password" type="password" autocomplete="current-password"><button data-testid="login">Sign in</button></form><p data-testid="auth-status">${signedIn ? "Signed in" : "Signed out"}</p>
<p data-testid="secret-echo">${signedIn ? "fixture-password" : ""}</p>
<label for="coupon">Coupon</label><input id="coupon" data-testid="coupon-input"><button data-testid="apply-coupon">Apply coupon</button><p data-testid="order-total">100000</p><p data-testid="validation-error" role="status"></p>
<label for="record-name">Record name</label><input id="record-name" data-testid="record-name"><button data-testid="create-record">Create</button><button data-testid="update-record">Update</button><button data-testid="delete-record">Delete</button><p data-testid="record">No records</p>
${url.searchParams.has("a11y") ? '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">' : ""}
</main><script>
const el=id=>document.querySelector('[data-testid="'+id+'"]');
el('apply-coupon').onclick=()=>{const valid=el('coupon-input').value==='SAVE10';el('order-total').textContent=valid?'${buggy ? "100000" : "90000"}':'100000';el('validation-error').textContent=valid?'':'${url.searchParams.has("accept-invalid") ? "" : "Enter SAVE10 to apply the demo discount."}';};
el('create-record').onclick=()=>el('record').textContent=el('record-name').value;
el('update-record').onclick=()=>el('record').textContent=${url.searchParams.has("broken-update") ? "'First record'" : "el('record-name').value"};
el('delete-record').onclick=()=>el('record').textContent='No records';
</script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    setBug(value: boolean) {
      buggy = value;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
