import { z } from "zod";

/** Shared project/navigation policy. Syntax validation remains separate from origin authorization. */
export const httpUrlSchema = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}, "Use an HTTP(S) URL without embedded credentials");
