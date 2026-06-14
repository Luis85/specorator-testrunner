import { describe, expect, it } from "vitest";
import {
  parseManifestVersion,
  parseManifestBrowsers,
} from "../src/application/content/runner-manifest-version";

describe("parseManifestVersion", () => {
  it("reads the version from valid manifest content", () => {
    expect(parseManifestVersion('{"manifestVersion": 3}')).toBe(3);
  });
  it("returns null for missing, malformed, or non-numeric versions", () => {
    expect(parseManifestVersion("not json")).toBeNull();
    expect(parseManifestVersion("{}")).toBeNull();
    expect(parseManifestVersion('{"manifestVersion": "x"}')).toBeNull();
    expect(parseManifestVersion(undefined)).toBeNull();
  });
});

describe("parseManifestBrowsers", () => {
  it("reads a valid browsers array from manifest content", () => {
    expect(
      parseManifestBrowsers('{"manifestVersion": 3, "browsers": ["chromium", "firefox"]}'),
    ).toEqual(["chromium", "firefox"]);
  });

  it("returns undefined for old manifests without the browsers field", () => {
    expect(parseManifestBrowsers('{"manifestVersion": 3}')).toBeUndefined();
  });

  it("returns undefined when browsers is not an array", () => {
    expect(parseManifestBrowsers('{"manifestVersion": 3, "browsers": "chromium"}')).toBeUndefined();
  });

  it("returns undefined when any element is not a string", () => {
    expect(
      parseManifestBrowsers('{"manifestVersion": 3, "browsers": ["chromium", 42]}'),
    ).toBeUndefined();
  });

  it("returns undefined for missing, malformed, or non-object content", () => {
    expect(parseManifestBrowsers(undefined)).toBeUndefined();
    expect(parseManifestBrowsers("not json")).toBeUndefined();
    expect(parseManifestBrowsers("{}")).toBeUndefined();
  });

  it("returns an empty array when browsers is an empty array", () => {
    expect(parseManifestBrowsers('{"manifestVersion": 3, "browsers": []}')).toEqual([]);
  });
});
