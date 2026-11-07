/** Do not permit scheme-relative, encoded, backslash or auth redirect loops. */
export function safeReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    /[\\\s%#]/.test(value)
  )
    return "/";
  try {
    const url = new URL(value, "https://local.invalid");
    if (
      url.origin !== "https://local.invalid" ||
      /^\/(?:login|api|_next)(?:\/|$)/.test(url.pathname)
    )
      return "/";
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}
