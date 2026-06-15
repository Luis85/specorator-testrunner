import type { DataStore } from "../ports/data-store";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { PathSafetyPolicy } from "../../domain/policies/path-safety-policy";
import { DEFAULT_SETTINGS, type TestHubSettings } from "../../domain/settings/settings";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";
import { SerialQueue } from "../../shared/async/serial-queue";
import { collectSettingsValidation, type SettingsValidationMessage } from "./settings-validation";
import { sanitizeLoadedSettings } from "./settings-sanitization";

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

export type { SettingsValidationMessage };

/**
 * The data.json schema version. Bumped when the persisted shape changes
 * incompatibly. Pre-announcement beta has no migration framework (proposal §9
 * Phase 2 scope): a present blob with a different version resets to defaults
 * with a logged report rather than being migrated.
 */
const DATA_SCHEMA_VERSION = 1;

/**
 * The schema version this envelope first shipped at — a FIXED historical
 * constant, NEVER updated when {@link DATA_SCHEMA_VERSION} bumps. A present blob
 * carrying no numeric `schemaVersion` predates the envelope, so it is treated as
 * this version: at v1 it equals {@link DATA_SCHEMA_VERSION} and merges, but once
 * the code bumps past 1 it no longer matches and resets. Kept distinct from
 * `DATA_SCHEMA_VERSION` so a future bump can't be "simplified" into folding the
 * two together (which would silently stop resetting legacy/corrupt blobs).
 */
const INITIAL_SCHEMA_VERSION = 1;

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

  /**
   * Serializes save()/reset() persistence. The settings tab debounces saves
   * PER FIELD (P4-9), so two quick edits to different fields produce two
   * overlapping save() calls; without serialization both would read the same
   * "previous", interleave their load→save→diff sections, and the last
   * whole-object write would win — silently dropping the first change (F2).
   */
  private readonly persistQueue = new SerialQueue();

  async load(): Promise<TestHubSettings> {
    const raw = await this.store.load();
    // A present blob whose EFFECTIVE version differs from the code → beta reset
    // (log + defaults, no migration). A present-but-unversioned blob is treated
    // as v1 (the version this envelope shipped at), so at v1 it still merges,
    // but a future incompatible bump resets it instead of merging stale data.
    // First run (no data.json) falls through to defaults silently.
    if (this.schemaVersionIsStale(raw)) {
      this.logger.error(
        "data.json schemaVersion differs from this build; resetting settings to defaults (beta: no migration).",
        undefined,
        { expected: DATA_SCHEMA_VERSION },
      );
      // PERSIST the reset so the stale blob is overwritten with stamped defaults
      // — otherwise every subsequent load repeats the reset/log instead of
      // converging, AND sensitive stale data lingers (e.g. the pre-cut-over
      // plaintext `auth.env` credentials this rail must drop, ADR-0024).
      // Write DIRECTLY, NOT through `persistQueue`: `save()` runs its whole body
      // inside `persistQueue.run(...)` and calls `await this.load()` to compute
      // changedFields, so re-entering the queue here would deadlock (the reset
      // queues behind the save that is awaiting it — the re-entrancy the
      // SerialQueue docs warn about). The direct write is a blind overwrite to
      // defaults, not a read-modify-write, so interleaving with that in-flight
      // save is benign: the save's own subsequent write supersedes it. A persist
      // failure is logged but does not block the load (returned defaults are
      // correct in memory).
      const persisted = await this.persist(DEFAULT_SETTINGS);
      if (!persisted.ok) {
        this.logger.error(
          "Failed to persist the settings reset; the stale blob remains.",
          persisted.error,
        );
      }
      return DEFAULT_SETTINGS;
    }
    return sanitizeLoadedSettings(raw, { logger: this.logger, pathSafety: this.pathSafety });
  }

  /**
   * True for a PRESENT blob whose EFFECTIVE schema version differs from the
   * code. Only `undefined` raw (no data.json) is the silent first run. ANY
   * present value — object, array, scalar, or null — is a stored blob: its
   * effective version is its numeric `schemaVersion` if it has one, else 1 (the
   * version this envelope shipped at, fixed forever, NOT `DATA_SCHEMA_VERSION`
   * which moves on each bump). So an unversioned or malformed present blob
   * merges while the code is at v1, but resets (and is overwritten) once the
   * code bumps past 1 — a corrupt non-object blob must not silently survive an
   * incompatible bump.
   */
  private schemaVersionIsStale(raw: unknown): boolean {
    if (raw === undefined) return false; // first run, not stale
    const version =
      typeof raw === "object" && raw !== null && !Array.isArray(raw)
        ? (raw as Record<string, unknown>).schemaVersion
        : undefined;
    // INITIAL_SCHEMA_VERSION (not DATA_SCHEMA_VERSION) is the fallback: any
    // present-but-unversioned/non-object blob predates the envelope, so it is
    // effectively the version this envelope shipped at.
    const effective = typeof version === "number" ? version : INITIAL_SCHEMA_VERSION;
    return effective !== DATA_SCHEMA_VERSION;
  }

  /** Persists settings under the schema envelope (stamps the current version). */
  private persist(settings: TestHubSettings): Promise<Result<void>> {
    return this.store.save({ schemaVersion: DATA_SCHEMA_VERSION, ...settings });
  }

  save(settings: TestHubSettings): Promise<Result<void>> {
    return this.persistQueue.run(async () => {
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
      const saved = await this.persist(settings);
      if (!saved.ok) return saved;
      const changedFields = diffSettings(previous, settings);
      await this.eventBus.publish(createEvent("settings.updated", { changedFields }));
      return ok(undefined);
    });
  }

  reset(correlationId?: string): Promise<Result<TestHubSettings>> {
    return this.persistQueue.run(async () => {
      const saved = await this.persist(DEFAULT_SETTINGS);
      if (!saved.ok) return saved;
      await this.eventBus.publish(
        createEvent("settings.reset", { profile: "default" }, { correlationId }),
      );
      return ok(DEFAULT_SETTINGS);
    });
  }

  async validate(settings: TestHubSettings): Promise<SettingsValidationResult> {
    const { errors, warnings } = await collectSettingsValidation(settings, {
      pathSafety: this.pathSafety,
      vaultFs: this.vaultFs,
    });
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
}

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
