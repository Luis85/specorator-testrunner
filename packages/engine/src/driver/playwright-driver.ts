// Default execution driver. Launches system Chrome via Playwright's `channel`
// (no bundled browser binaries) and gets auto-wait, tracing, and native
// screenshot masking for free. See DESIGN.md section 2.
//
// TODO(phase-1): implement with playwright-core.

import type {
  ApiRequest,
  ApiResponse,
  Driver,
  ScreenshotOpts,
  Target,
} from "./driver";
import type { ArtifactRef } from "../types";

export class PlaywrightDriver implements Driver {
  private notImplemented(): never {
    throw new Error("PlaywrightDriver: not implemented yet (Phase 1)");
  }

  async open(_url: string): Promise<void> {
    this.notImplemented();
  }
  async click(_target: Target): Promise<void> {
    this.notImplemented();
  }
  async fill(_target: Target, _value: string): Promise<void> {
    this.notImplemented();
  }
  async select(_target: Target, _option: string): Promise<void> {
    this.notImplemented();
  }
  async check(_target: Target, _checked: boolean): Promise<void> {
    this.notImplemented();
  }
  async press(_key: string): Promise<void> {
    this.notImplemented();
  }
  async hover(_target: Target): Promise<void> {
    this.notImplemented();
  }
  async getText(_target: Target): Promise<string> {
    this.notImplemented();
  }
  async isVisible(_target: Target): Promise<boolean> {
    this.notImplemented();
  }
  async waitFor(_target: Target, _state: "visible" | "hidden"): Promise<void> {
    this.notImplemented();
  }
  async url(): Promise<string> {
    this.notImplemented();
  }
  async title(): Promise<string> {
    this.notImplemented();
  }
  async screenshot(_opts?: ScreenshotOpts): Promise<ArtifactRef> {
    this.notImplemented();
  }
  async apiRequest(_req: ApiRequest): Promise<ApiResponse> {
    this.notImplemented();
  }
  async close(): Promise<void> {
    // no-op until implemented
  }
}
