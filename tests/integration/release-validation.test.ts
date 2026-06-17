import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * FEAT-028 — Release Validation.
 *
 * Encodes the machine-checkable parts of a release checklist as a test so a
 * regression that would ship a broken plugin fails CI rather than a human
 * reviewer. Covers the Obsidian plugin manifest contract (id/version present and
 * consistent with package.json), the build artifact (`main.js` produced by the
 * esbuild config), the registered command surface, and a "no leftover work
 * markers in shipped source" hygiene gate.
 *
 * Pure read-only filesystem assertions over the repo — no production code.
 */

const repoRoot = join(__dirname, "..", "..");
const readJson = (rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(repoRoot, rel), "utf8")) as Record<string, unknown>;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/;

describe("release validation: manifest contract", () => {
  const manifest = readJson("manifest.json");
  const pkg = readJson("package.json");

  it("manifest.json declares a plugin id, name and semver version", () => {
    expect(typeof manifest.id).toBe("string");
    expect((manifest.id as string).length).toBeGreaterThan(0);
    expect(typeof manifest.name).toBe("string");
    expect((manifest.name as string).length).toBeGreaterThan(0);
    expect(typeof manifest.version).toBe("string");
    expect(manifest.version as string).toMatch(SEMVER);
  });

  it("manifest version is consistent with package.json version", () => {
    expect(manifest.version).toBe(pkg.version);
  });

  it("versions.json maps the manifest version to its minAppVersion", () => {
    // Obsidian's installer consults versions.json to pick a compatible release;
    // a missing or stale entry would offer the new version to vaults that
    // cannot run it.
    const versions = readJson("versions.json");
    expect(versions[manifest.version as string]).toBe(manifest.minAppVersion);
  });

  it("manifest declares the required Obsidian fields", () => {
    expect(typeof manifest.minAppVersion).toBe("string");
    expect(typeof manifest.description).toBe("string");
    // The plugin spawns Node child processes / touches the FS, so it must be
    // desktop-only — shipping it mobile-enabled would crash on load.
    expect(manifest.isDesktopOnly).toBe(true);
  });
});

describe("release validation: build artifact", () => {
  // main.js is a build output (not tracked), and CI runs `npm run test` BEFORE
  // `npm run build` — so only validate the bundle when present (e.g. after a
  // local/release build). The CI build step is the gate that it's produced;
  // this just guards against a broken/empty bundle when one exists.
  const mainPath = join(repoRoot, "main.js");
  it.skipIf(!existsSync(mainPath))("a present main.js bundle is non-trivial", () => {
    // esbuild bundles every service; a few hundred bytes would mean a broken
    // build. Use a conservative floor so the assertion is stable.
    expect(statSync(mainPath).size).toBeGreaterThan(10_000);
    const bundle = readFileSync(mainPath, "utf8");
    // The bundle must export an Obsidian Plugin default export.
    expect(bundle).toContain("module.exports");
  });
});

describe("release validation: registered command surface", () => {
  // Command registration lives in presentation/commands (P2-7); main.ts is the
  // composition root that calls registerCommands, which delegates the run/cancel/
  // import commands to register-run-commands. Scan all three so the gate keeps
  // working wherever a command is registered.
  const commandSource =
    readFileSync(join(repoRoot, "src", "main.ts"), "utf8") +
    readFileSync(
      join(repoRoot, "src", "presentation", "commands", "register-commands.ts"),
      "utf8",
    ) +
    readFileSync(
      join(repoRoot, "src", "presentation", "commands", "register-run-commands.ts"),
      "utf8",
    );
  const commandIds = [...commandSource.matchAll(/addCommand\(\{[\s\S]*?id:\s*"([^"]+)"/g)].map(
    (m) => m[1],
  );

  it("registers the core release-critical commands", () => {
    // These back the primary user flows (init, validate, run, CI). If any is
    // dropped the corresponding UC has no entry point.
    const required = [
      "initialize-test-hub",
      "validate-environment",
      "generate-ci-workflow",
      "run-demo-test",
      "run-all-tests",
    ];
    for (const id of required) {
      expect(commandIds, `command "${id}" is not registered`).toContain(id);
    }
  });

  it("has no duplicate command ids", () => {
    expect(new Set(commandIds).size).toBe(commandIds.length);
  });
});

describe("release validation: source hygiene", () => {
  const collect = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...collect(full));
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
    return out;
  };

  it("ships no TODO/FIXME markers in src", () => {
    const offenders: string[] = [];
    for (const file of collect(join(repoRoot, "src"))) {
      if (/\b(TODO|FIXME)\b/.test(readFileSync(file, "utf8"))) {
        offenders.push(file.slice(repoRoot.length + 1));
      }
    }
    expect(offenders, `leftover work markers: ${offenders.join(", ")}`).toEqual([]);
  });
});
