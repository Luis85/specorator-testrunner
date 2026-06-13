/**
 * Reads the `manifestVersion` from a `testrunner-manifest.json` body. Returns
 * `null` when the file is absent (undefined), unparseable, or carries no
 * numeric version — all of which mean "older than the first stamped runner"
 * and signal a repair (the runner predates this manifest).
 */
export const parseManifestVersion = (content: string | undefined): number | null => {
  if (content === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const version = (parsed as Record<string, unknown>).manifestVersion;
  return typeof version === "number" && Number.isFinite(version) ? version : null;
};
