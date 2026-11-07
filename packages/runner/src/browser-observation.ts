import type { Locator, Page } from "@playwright/test";
import {
  targetRoles,
  type BrowserObservation,
  type Target,
} from "@veriflow/core";
import { permitsUrl } from "./browser-policy.ts";

export function publicPageUrl(value: string) {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.href;
}

/** Reads the current page; never clicks, fills, follows links or creates media. */
export async function readBrowserObservation(
  page: Page,
  maxCharacters: number,
  origins: ReadonlySet<string>,
  locator: (target: Target) => Locator,
): Promise<BrowserObservation> {
  let settled = true;
  try {
    await page.waitForLoadState("networkidle", { timeout: 1500 });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
    settled = false;
  }
  const raw = await page.evaluate(
    ({ limit, roles }) => {
      const visibility = {
        visible(element: Element) {
          const style = getComputedStyle(element);
          return (
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            element.getClientRects().length > 0
          );
        },
      };
      const dialogs = [
        ...document.querySelectorAll('dialog[open], [role="dialog"]'),
      ].filter(visibility.visible);
      const mains = [
        ...document.querySelectorAll('main, [role="main"]'),
      ].filter(visibility.visible);
      const scope: "main" | "dialog" | "body" =
        dialogs.length === 1 ? "dialog" : mains.length === 1 ? "main" : "body";
      const root =
        scope === "dialog"
          ? dialogs[0]!
          : scope === "main"
            ? mains[0]!
            : document.body;
      const chunks: string[] = [];
      let characters = 0;
      let visited = 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      // Do not include input/textarea values, scripts, hidden content or credentials in fields.
      while ((node = walker.nextNode())) {
        if (++visited > 5000 || characters > limit) break;
        const parent = node.parentElement;
        if (
          parent &&
          !parent.closest("script,style,input,textarea") &&
          visibility.visible(parent)
        ) {
          const text = node.textContent?.trim();
          if (text) {
            chunks.push(text.slice(0, limit + 1));
            characters += text.length + 1;
          }
        }
      }
      const text = chunks.join("\n");
      const candidates: Target[] = [];
      const collector = {
        add(target: Target) {
          if (
            target.value.trim() &&
            target.value.length <= 256 &&
            candidates.length < 150
          )
            candidates.push(target);
        },
      };
      for (const element of root.querySelectorAll(
        "[data-testid],label,button,a[href],input,textarea,select,h1,h2,h3,h4,h5,h6,[role]",
      )) {
        if (candidates.length >= 150) break;
        if (!visibility.visible(element)) continue;
        const testId = element.getAttribute("data-testid");
        if (testId) collector.add({ by: "testId", value: testId });
        if (element.tagName === "LABEL") {
          const clone = element.cloneNode(true) as Element;
          clone
            .querySelectorAll("input,textarea,select")
            .forEach((control) => control.remove());
          collector.add({
            by: "label",
            value: clone.textContent?.trim() ?? "",
          });
        }
        let role = element.getAttribute("role")?.split(/\s+/)[0];
        if (!role) {
          const tag = element.tagName.toLowerCase();
          role =
            tag === "button"
              ? "button"
              : tag === "a"
                ? "link"
                : /^h[1-6]$/.test(tag)
                  ? "heading"
                  : tag === "select"
                    ? "combobox"
                    : tag === "textarea"
                      ? "textbox"
                      : undefined;
          if (tag === "input") {
            const type = (element as HTMLInputElement).type;
            role = ["checkbox", "radio"].includes(type)
              ? type
              : ["button", "submit", "reset"].includes(type)
                ? "button"
                : ["text", "email", "tel", "url"].includes(type)
                  ? "textbox"
                  : undefined;
          }
        }
        if (!role || !roles.includes(role as (typeof roles)[number])) continue;
        const referenced = element
          .getAttribute("aria-labelledby")
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ");
        const labels =
          "labels" in element
            ? Array.from((element as HTMLInputElement).labels ?? [])
                .map((label) => {
                  const clone = label.cloneNode(true) as Element;
                  clone
                    .querySelectorAll("input,textarea,select")
                    .forEach((control) => control.remove());
                  return clone.textContent?.trim() ?? "";
                })
                .join(" ")
            : "";
        const name =
          referenced ||
          element.getAttribute("aria-label") ||
          labels ||
          (!["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)
            ? element.textContent?.trim()
            : "") ||
          element.getAttribute("title") ||
          "";
        collector.add({
          by: "role",
          role: role as (typeof roles)[number],
          value: name,
        });
      }
      const links = [...root.querySelectorAll<HTMLAnchorElement>("a[href]")]
        .filter(visibility.visible)
        .slice(0, 40)
        .map((a) => ({
          url: a.href,
          label: (a.textContent?.trim() ?? "").slice(0, 256),
        }));
      return {
        title: document.title.slice(0, 512),
        text: text.slice(0, limit),
        candidates,
        links,
        scope,
        passwordFieldVisible: [
          ...root.querySelectorAll('input[type="password"]'),
        ].some(visibility.visible),
        truncated:
          visited > 5000 ||
          characters > limit ||
          text.length > limit ||
          candidates.length >= 150 ||
          links.length > 20,
      };
    },
    { limit: maxCharacters, roles: [...targetRoles] },
  );
  const targets: Target[] = [];
  const seen = new Set<string>();
  for (const candidate of raw.candidates) {
    const key = JSON.stringify(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    const match = locator(candidate);
    // DOM text is only a candidate; Playwright verifies the actual accessible name and uniqueness.
    if ((await match.count()) === 1 && (await match.isVisible()))
      targets.push(candidate);
    if (targets.length === 50) break;
  }
  return {
    url: publicPageUrl(page.url()),
    title: raw.title,
    text: raw.text,
    scope: raw.scope,
    passwordFieldVisible: raw.passwordFieldVisible,
    truncated: raw.truncated || !settled || targets.length === 50,
    targets,
    links: raw.links
      .filter((link) => permitsUrl(link.url, origins))
      .slice(0, 20)
      .map((link) => ({ ...link, url: publicPageUrl(link.url) })),
    capturedAt: new Date().toISOString(),
  };
}
