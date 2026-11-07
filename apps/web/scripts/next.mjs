// Keep Next's normal CLI and signal handling, with an overridable project default.
process.env.PORT ||= "1111";
await import("next/dist/bin/next");
