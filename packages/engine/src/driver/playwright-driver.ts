// Default execution driver. Launches system Chrome via Playwright's `channel`
// (no bundled browser binaries) and gets auto-wait, tracing, and native
// screenshot masking for free. See DESIGN.md section 2.

import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core";
import type {
  ApiRequest,
  ApiResponse,
  Driver,
  ScreenshotOpts,
  Target,
} from "./driver";
import type { ArtifactRef } from "../types";

export interface PlaywrightDriverOptions {
  /** Browser channel; defaults to system Chrome. */
  channel?: string;
  headless?: boolean;
  baseURL?: string;
  timeoutMs?: number;
  /** Directory for screenshots/artifacts. */
  artifactDir?: string;
}

type Role = Parameters<Page["getByRole"]>[0];

/** Resolve a Target into a Playwright Locator (accessibility-first). */
function resolveLocator(page: Page, target: Target): Locator {
  const raw = target.raw;
  const eq = raw.indexOf("=");
  const prefix = eq > 0 ? raw.slice(0, eq) : "";
  const value = eq > 0 ? raw.slice(eq + 1) : raw;

  switch (prefix) {
    case "css":
      return page.locator(value);
    case "xpath":
      return page.locator(`xpath=${value}`);
    case "text":
      return page.getByText(value);
    case "label":
      return page.getByLabel(value);
    case "placeholder":
      return page.getByPlaceholder(value);
    case "testid":
      return page.getByTestId(value);
    case "role": {
      const m = value.match(/^([a-zA-Z]+)(?:\[(.+)\])?$/);
      if (m) {
        return page.getByRole(m[1] as Role, m[2] ? { name: m[2] } : undefined);
      }
      return page.getByRole(value as Role);
    }
    default:
      // Bare target: prefer accessible text, fall back to a raw selector.
      return page.getByText(raw).or(page.locator(raw));
  }
}

export class PlaywrightDriver implements Driver {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;

  constructor(private readonly opts: PlaywrightDriverOptions = {}) {}

  async init(): Promise<void> {
    this.browser = await chromium.launch({
      channel: this.opts.channel ?? "chrome",
      headless: this.opts.headless ?? true,
    });
    this.context = await this.browser.newContext({ baseURL: this.opts.baseURL });
    this.page = await this.context.newPage();
    if (this.opts.timeoutMs) {
      this.page.setDefaultTimeout(this.opts.timeoutMs);
    }
  }

  private get p(): Page {
    if (!this.page) {
      throw new Error("PlaywrightDriver not initialized; call init() first");
    }
    return this.page;
  }

  private loc(target: Target): Locator {
    return resolveLocator(this.p, target);
  }

  async open(url: string): Promise<void> {
    await this.p.goto(url);
  }
  async click(target: Target): Promise<void> {
    await this.loc(target).click();
  }
  async fill(target: Target, value: string): Promise<void> {
    await this.loc(target).fill(value);
  }
  async select(target: Target, option: string): Promise<void> {
    await this.loc(target).selectOption(option);
  }
  async check(target: Target, checked: boolean): Promise<void> {
    if (checked) await this.loc(target).check();
    else await this.loc(target).uncheck();
  }
  async press(key: string): Promise<void> {
    await this.p.keyboard.press(key);
  }
  async hover(target: Target): Promise<void> {
    await this.loc(target).hover();
  }
  async getText(target: Target): Promise<string> {
    return (await this.loc(target).textContent()) ?? "";
  }
  async isVisible(target: Target): Promise<boolean> {
    return this.loc(target).isVisible();
  }
  async waitFor(target: Target, state: "visible" | "hidden"): Promise<void> {
    await this.loc(target).waitFor({ state });
  }
  async url(): Promise<string> {
    return this.p.url();
  }
  async title(): Promise<string> {
    return this.p.title();
  }
  async screenshot(opts?: ScreenshotOpts): Promise<ArtifactRef> {
    const dir = this.opts.artifactDir ?? ".";
    const file = path.join(dir, `screenshot-${Date.now()}.png`);
    const mask = opts?.maskSelectors?.map((sel) => this.p.locator(sel));
    await this.p.screenshot({ path: file, fullPage: opts?.fullPage, mask });
    return { path: file, mediaType: "image/png" };
  }
  async apiRequest(req: ApiRequest): Promise<ApiResponse> {
    const res = await this.p.request.fetch(req.url, {
      method: req.method,
      data: req.json,
      form: req.form,
      headers: req.headers,
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    return { status: res.status(), body, headers: res.headers() };
  }
  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }
}
