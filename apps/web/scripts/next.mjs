// Keep Next's normal CLI and signal handling, with an overridable project default.
process.env.PORT ||= "1111";
// Turbopack's HMR hash mismatch loop can survive restarts in this workspace.
// Keep Fast Refresh using Webpack by default; explicit bundler flags still work.
if (
  process.argv[2] === "dev" &&
  !process.argv.some((arg) =>
    ["--webpack", "--turbopack", "--turbo"].includes(arg),
  )
) {
  process.argv.push("--webpack");
}
await import("next/dist/bin/next");
