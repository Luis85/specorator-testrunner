import type { DataStore } from "../ports/data-store";
import type { PathSafetyPolicy } from "../../domain/policies/path-safety-policy";
import {
  DEFAULT_SETTINGS,
  type TestHubPathSettings,
  type TestHubSettings,
} from "../../domain/settings/settings";
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
  reset(): Promise<Result<TestHubSettings>>;
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
    return { ...settings, paths };
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
    await this.store.save(settings);
    await this.eventBus.publish(createEvent("settings.updated", { settings }));
    return ok(undefined);
  }

  async reset(): Promise<Result<TestHubSettings>> {
    await this.store.save(DEFAULT_SETTINGS);
    await this.eventBus.publish(createEvent("settings.reset", {}));
    return ok(DEFAULT_SETTINGS);
  }

  async validate(settings: TestHubSettings): Promise<SettingsValidationResult> {
    const errors: SettingsValidationMessage[] = [];
    const warnings: SettingsValidationMessage[] = [];

    for (const [field, value] of Object.entries(settings.paths) as [
      keyof TestHubPathSettings,
      string,
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

    const result: SettingsValidationResult = {
      valid: errors.length === 0,
      errors,
      warnings,
    };
    await this.eventBus.publish(createEvent("settings.validated", { result }));
    return result;
  }
}
