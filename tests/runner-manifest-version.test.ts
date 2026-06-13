import { describe, expect, it } from "vitest";
import { parseManifestVersion } from "../src/application/content/runner-manifest-version";

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
