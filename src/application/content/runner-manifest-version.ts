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

/**
 * Reads the `browsers` array from a `testrunner-manifest.json` body. Returns
 * the array when present and valid (array of strings), `undefined` otherwise —
 * old manifests without the field return `undefined`, which callers treat as
 * drift (missing stamp on a current manifest = regenerate needed).
 */
export const parseManifestBrowsers = (content: string | undefined): string[] | undefined => {
  if (content === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const browsers = (parsed as Record<string, unknown>).browsers;
  if (!Array.isArray(browsers)) return undefined;
  if (!browsers.every((b): b is string => typeof b === "string")) return undefined;
  return browsers;
};
