// The driver-agnostic execution surface. Everything above this interface
// (gherkin, vocabulary, variables, reports, flows) is driver-independent.
// See DESIGN.md section 2.

import type { ArtifactRef } from "../types";

/** A resolved-at-runtime locator parsed from a quoted target string. */
export interface Target {
  /** The quoted target string exactly as authored, e.g. "role=button[Sign in]". */
  raw: string;
  /** Optional "within <container>" scope. */
  scope?: string;
  /** Optional 1-based ordinal to disambiguate ("the 2nd ..."). */
  ordinal?: number;
}

export interface ScreenshotOpts {
  fullPage?: boolean;
  /** Selectors for secret-bound inputs to mask BEFORE capture (see DESIGN.md section 3). */
  maskSelectors?: string[];
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** State-setup request for the (api) step family. */
export interface ApiRequest {
  method: HttpMethod;
  url: string;
  json?: unknown;
  form?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface Driver {
  open(url: string): Promise<void>;
  click(target: Target): Promise<void>;
  fill(target: Target, value: string): Promise<void>;
  select(target: Target, option: string): Promise<void>;
  check(target: Target, checked: boolean): Promise<void>;
  press(key: string): Promise<void>;
  hover(target: Target): Promise<void>;
  getText(target: Target): Promise<string>;
  isVisible(target: Target): Promise<boolean>;
  waitFor(target: Target, state: "visible" | "hidden"): Promise<void>;
  url(): Promise<string>;
  title(): Promise<string>;
  screenshot(opts?: ScreenshotOpts): Promise<ArtifactRef>;
  /** Drives the (api) state-setup family; can seed browser storage state. */
  apiRequest(req: ApiRequest): Promise<ApiResponse>;
  close(): Promise<void>;
}
