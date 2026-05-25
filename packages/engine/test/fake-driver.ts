import type {
  ApiRequest,
  ApiResponse,
  Driver,
  ScreenshotOpts,
  Target,
} from "../src/driver/driver";
import type { ArtifactRef } from "../src/types";

/** In-memory Driver for unit tests — records calls, returns scripted answers. */
export class FakeDriver implements Driver {
  calls: string[] = [];
  currentUrl = "about:blank";
  /** Targets/text considered visible (by raw string). */
  visible = new Set<string>();
  texts: Record<string, string> = {};

  async open(url: string): Promise<void> {
    this.calls.push(`open ${url}`);
    this.currentUrl = url;
  }
  async click(t: Target): Promise<void> {
    this.calls.push(`click ${t.raw}`);
  }
  async fill(t: Target, value: string): Promise<void> {
    this.calls.push(`fill ${t.raw}=${value}`);
  }
  async select(t: Target, option: string): Promise<void> {
    this.calls.push(`select ${t.raw}=${option}`);
  }
  async check(t: Target, checked: boolean): Promise<void> {
    this.calls.push(`check ${t.raw}=${checked}`);
  }
  async press(key: string): Promise<void> {
    this.calls.push(`press ${key}`);
  }
  async hover(t: Target): Promise<void> {
    this.calls.push(`hover ${t.raw}`);
  }
  async getText(t: Target): Promise<string> {
    return this.texts[t.raw] ?? "";
  }
  async isVisible(t: Target): Promise<boolean> {
    return this.visible.has(t.raw);
  }
  async waitFor(t: Target, state: "visible" | "hidden"): Promise<void> {
    this.calls.push(`waitFor ${t.raw} ${state}`);
  }
  async url(): Promise<string> {
    return this.currentUrl;
  }
  async title(): Promise<string> {
    return "Fake";
  }
  async screenshot(_opts?: ScreenshotOpts): Promise<ArtifactRef> {
    return { path: "fake.png", mediaType: "image/png" };
  }
  async apiRequest(_req: ApiRequest): Promise<ApiResponse> {
    return { status: 200, body: {}, headers: {} };
  }
  async close(): Promise<void> {}
}
