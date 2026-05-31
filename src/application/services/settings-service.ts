import type { DataStore } from "../ports/data-store";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { PathSafetyPolicy } from "../../domain/policies/path-safety-policy";
import {
  DEFAULT_SETTINGS,
  type TestHubPathSettings,
  type TestHubSettings,
} from "../../domain/settings/settings";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { unsafeVaultPath } from "../../domain/value-objects/vault-path";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";

/** No-op logger so tests can construct the service without wiring one. */
const NOOP_LOGGER: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Settings application contract (TIS §5.9). */
export interface SettingsService {
  load(): Promise<TestHubSettings>;
  save(settings: TestHubSettings): Promise<Result<void>>;
  /**
   * Restores defaults and emits `settings.reset`. A `correlationId` may be
   * threaded in by {@link MaintenanceService.reset} (UC-024) so `settings.reset`
   * shares the single reset-invocation id with the re-initialization chain that
   * follows it (Event Catalog §19).
   */
  reset(correlationId?: string): Promise<Result<TestHubSettings>>;
  validate(settings: TestHubSettings): Promise<SettingsValidationResult>;
}

export interface SettingsValidationResult {
  valid: boolean;
  errors: SettingsValidationMessage[];
  warnings: SettingsValidationMessage[];
}

export interface SettingsValidationMessage {
  field: string;
  message: string;
  severity: "error" | "warning";
}

/** Shallow-by-section merge of persisted data over defaults. */
const mergeWithDefaults = (raw: unknown): TestHubSettings => {
  const data = (raw ?? {}) as Partial<TestHubSettings>;
  return {
    paths: { ...DEFAULT_SETTINGS.paths, ...data.paths },
    runner: { ...DEFAULT_SETTINGS.runner, ...data.runner },
    automation: { ...DEFAULT_SETTINGS.automation, ...data.automation },
    ci: { ...DEFAULT_SETTINGS.ci, ...data.ci },
    sut: { ...DEFAULT_SETTINGS.sut, ...data.sut },
    logging: { ...DEFAULT_SETTINGS.logging, ...data.logging },
  };
};

export class DefaultSettingsService implements SettingsService {
  constructor(
    private readonly store: DataStore,
    private readonly pathSafety: PathSafetyPolicy,
    private readonly eventBus: EventBus,
    private readonly logger: Logger = NOOP_LOGGER,
    /**
     * Optional vault access for the ADR-0015 one-project-per-vault check. When
     * omitted (e.g. in unit tests that don't exercise it) the check is skipped,
     * so existing call sites and behaviour are unaffected.
     */
    private readonly vaultFs?: VaultFileSystem,
  ) {}

  async load(): Promise<TestHubSettings> {
    return this.sanitizePaths(mergeWithDefaults(await this.store.load()));
  }

  /**
   * Screens every configured path through PathSafetyPolicy on load. A
   * tampered/synced `data.json` could otherwise carry an unsafe path straight
   * into a code-generation sink (e.g. the `cucumber.mjs` feature glob, SEC-1 /
   * P0-1) — `save()` validates, but `load()` historically did not. Any unsafe
   * path is logged and replaced with its `DEFAULT_SETTINGS` value so the unsafe
   * value never reaches the runner generator, without breaking normal startup.
   */
  private sanitizePaths(settings: TestHubSettings): TestHubSettings {
    const paths = { ...settings.paths };
    for (const field of Object.keys(paths) as (keyof TestHubPathSettings)[]) {
      const safe = this.pathSafety.validate(paths[field]);
      if (!safe.ok) {
        this.logger.error(
          `Configured path "paths.${field}" is unsafe; falling back to the default.`,
          safe.error,
          { field, value: paths[field], fallback: DEFAULT_SETTINGS.paths[field] },
        );
        paths[field] = DEFAULT_SETTINGS.paths[field];
      } else {
        // Validated above — brand the value so the loaded settings carry a
        // genuine VaultPath out of this ADR-0008 load-time chokepoint.
        paths[field] = unsafeVaultPath(paths[field]);
      }
    }
    const loggingPath = this.pathSafety.validate(settings.logging.path);
    if (!loggingPath.ok) {
      this.logger.error(
        `Configured path "logging.path" is unsafe; falling back to the default.`,
        loggingPath.error,
        { value: settings.logging.path, fallback: DEFAULT_SETTINGS.logging.path },
      );
      return {
        ...settings,
        paths,
        logging: { ...settings.logging, path: DEFAULT_SETTINGS.logging.path },
      };
    }
    return {
      ...settings,
      paths,
      logging: { ...settings.logging, path: unsafeVaultPath(settings.logging.path) },
    };
  }

  async save(settings: TestHubSettings): Promise<Result<void>> {
    const validation = await this.validate(settings);
    if (!validation.valid) {
      return err(
        appError("SETTINGS_INVALID", "Settings failed validation.", {
          details: { errors: validation.errors },
        }),
      );
    }
    // Diff the persisted settings against the incoming ones so the event
    // carries the real changed field names (Event Catalog §13: { changedFields }).
    const previous = await this.load();
    await this.store.save(settings);
    const changedFields = diffSettings(previous, settings);
    await this.eventBus.publish(createEvent("settings.updated", { changedFields }));
    return ok(undefined);
  }

  async reset(correlationId?: string): Promise<Result<TestHubSettings>> {
    await this.store.save(DEFAULT_SETTINGS);
    await this.eventBus.publish(
      createEvent("settings.reset", { profile: "default" }, { correlationId }),
    );
    return ok(DEFAULT_SETTINGS);
  }

  async validate(settings: TestHubSettings): Promise<SettingsValidationResult> {
    const errors: SettingsValidationMessage[] = [];
    const warnings: SettingsValidationMessage[] = [];

    for (const [field, value] of Object.entries(settings.paths) as [
      keyof TestHubPathSettings,
      VaultPath,
    ][]) {
      const safe = this.pathSafety.validate(value);
      if (!safe.ok) {
        errors.push({ field: `paths.${field}`, message: safe.error.message, severity: "error" });
      }
    }

    const loggingPath = this.pathSafety.validate(settings.logging.path);
    if (!loggingPath.ok) {
      errors.push({
        field: "logging.path",
        message: loggingPath.error.message,
        severity: "error",
      });
    }

    if (!settings.sut.environments[settings.sut.active]) {
      errors.push({
        field: "sut.active",
        message: `Active environment "${settings.sut.active}" is not defined.`,
        severity: "error",
      });
    }

    if (!settings.ci.nodeVersion.trim()) {
      warnings.push({
        field: "ci.nodeVersion",
        message: "CI Node version is empty; the generated workflow may be invalid.",
        severity: "warning",
      });
    }

    // ADR-0015 one-project-per-vault: surface (as a WARNING, never an error so
    // the plugin still loads) any sibling/duplicate Test Hub folder.
    const siblingWarning = await this.detectSiblingTestHub(settings);
    if (siblingWarning) warnings.push(siblingWarning);

    const result: SettingsValidationResult = {
      valid: errors.length === 0,
      errors,
      warnings,
    };
    // Event Catalog §13: { valid, warnings: string[] }. The full validation
    // messages stay on the returned result; the event carries warning text only.
    await this.eventBus.publish(
      createEvent("settings.validated", {
        valid: result.valid,
        warnings: warnings.map((warning) => warning.message),
      }),
    );
    return result;
  }

  /**
   * ADR-0015 (one project per vault): detect a sibling/duplicate `Test Hub`
   * folder colliding with the configured `testHubPath` and return it as a
   * single validation WARNING. Returns `undefined` (no-op) for the normal
   * single-folder vault, when no vault access is wired, or on any listing
   * failure (the check is advisory and must never break validation).
   *
   * Conservative interpretation — chosen because ADR-0015 only wants to flag
   * the "user copied another project's content into the vault" accident, and
   * because a warning (not a hard load failure) is the right severity for an
   * advisory data-hygiene problem:
   *
   *  - Only folders that are SIBLINGS of the configured Test Hub — i.e. share
   *    its parent directory — are considered. The settings model permits
   *    relocating `testHubPath` to a nested path (e.g. `QA/Test Hub`), and a
   *    sync/copy conflict ("Test Hub copy", "Test Hub 2") lands beside it in the
   *    SAME parent ("QA/Test Hub copy"); comparing by parent catches both the
   *    top-level and relocated cases. A folder under a different parent that
   *    merely happens to be named "Test Hub" is ignored (review P2).
   *  - A sibling collides when its base name equals the configured folder's base
   *    name, OR starts with it followed by a sync/copy-style suffix (a space/dash
   *    + "copy"/digits/"(n)"). A distinct folder that only shares a prefix word
   *    ("Test Hub Notes") is NOT flagged — avoiding false positives.
   *  - The configured folder itself is excluded; only an ADDITIONAL match
   *    triggers the warning.
   */
  private async detectSiblingTestHub(
    settings: TestHubSettings,
  ): Promise<SettingsValidationMessage | undefined> {
    if (!this.vaultFs) return undefined;

    const configured = settings.paths.testHubPath.trim();
    if (configured === "") return undefined;
    const configuredBase = baseName(configured);
    if (configuredBase === "") return undefined;
    const configuredKey = configuredBase.toLowerCase();
    // The parent the canonical Test Hub lives in ("" for a top-level folder,
    // "QA" for a relocated "QA/Test Hub"). Only folders in this same parent are
    // siblings; this is what makes the check work for a relocated testHubPath.
    const configuredParent = parentDir(configured);

    const listed = await this.vaultFs.listFolders();
    if (!listed.ok) return undefined; // advisory: never fail validation on a listing error

    const conflicts: string[] = [];
    const seen = new Set<string>();
    for (const folderPath of listed.value) {
      const trimmed = folderPath.trim();
      if (trimmed === "") continue;
      if (parentDir(trimmed) !== configuredParent) continue; // siblings only (same parent)
      if (trimmed === configured) continue; // the canonical Test Hub itself
      if (!isTestHubSibling(baseName(trimmed), configuredKey)) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push(trimmed);
    }

    if (conflicts.length === 0) return undefined;

    return {
      field: "paths.testHubPath",
      message:
        `More than one Test Hub folder was found in this vault ` +
        `(duplicates: ${conflicts.join(", ")}). A vault must contain exactly one ` +
        `Test Hub (ADR-0015). Remove or rename the duplicate(s) to avoid ambiguous ` +
        `roll-ups and ID generation.`,
      severity: "warning",
    };
  }
}

/** Last `/`-separated, non-empty segment of a vault path. */
const baseName = (path: string): string => {
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts.length === 0 ? "" : parts[parts.length - 1];
};

/** Parent directory of a vault path ("" for a top-level folder), normalized. */
const parentDir = (path: string): string => {
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts.slice(0, -1).join("/");
};

/**
 * True when `folderBaseName` (a folder's final segment) is a sync/copy-style
 * duplicate of the configured Test Hub's base name. Matches an exact name or the
 * base name followed by a conflict suffix (" 1", "-2", " copy", "copy", " (1)");
 * a folder whose suffix is a real alphabetic word (e.g. "test hub notes") is NOT
 * a duplicate.
 */
const isTestHubSibling = (folderBaseName: string, configuredKey: string): boolean => {
  const key = folderBaseName.toLowerCase();
  if (key === configuredKey) return true;
  if (!key.startsWith(configuredKey)) return false;
  const suffix = key.slice(configuredKey.length).trim();
  return /^[-_]?\s*(copy|\(?\d+\)?)?$/.test(suffix);
};

/**
 * Dotted field paths whose values differ between two settings objects, compared
 * section-by-section (one level deep, matching the mergeWithDefaults shape).
 * Each leaf is compared by JSON value so nested structures (e.g. environments)
 * register as a single changed field.
 */
const diffSettings = (before: TestHubSettings, after: TestHubSettings): string[] => {
  const changed: string[] = [];
  const sections = Object.keys(after) as (keyof TestHubSettings)[];
  for (const section of sections) {
    const beforeSection = before[section] as unknown as Record<string, unknown>;
    const afterSection = after[section] as unknown as Record<string, unknown>;
    const fields = new Set([
      ...Object.keys(beforeSection ?? {}),
      ...Object.keys(afterSection ?? {}),
    ]);
    for (const field of fields) {
      if (JSON.stringify(beforeSection?.[field]) !== JSON.stringify(afterSection?.[field])) {
        changed.push(`${section}.${field}`);
      }
    }
  }
  return changed;
};
