import {
  buildSuiteNote,
  DEFAULT_SUITES,
  type DefaultSuiteSeed,
} from "../content/default-suites";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SettingsService } from "./settings-service";
import type { TestSuite } from "../../domain/entities/suite";
import type { SuiteId } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath } from "../../shared/utils/vault-path";

export interface CreateSuiteRequest {
  name: string;
  description?: string;
  tagExpression: string;
}

/**
 * Suite lifecycle (TIS §8.8). Sprint 1 implements the creation surface the
 * Initialization Wizard needs; read/index methods (`findAll`,
 * `resolveTagExpression`) arrive with EPIC-006 Test Suite Management.
 */
export interface SuiteService {
  create(request: CreateSuiteRequest): Promise<Result<TestSuite>>;
  createDefaults(): Promise<Result<TestSuite[]>>; // Smoke + Regression per G1
}

const slugify = (name: string): SuiteId =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export class DefaultSuiteService implements SuiteService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
  ) {}

  async create(request: CreateSuiteRequest): Promise<Result<TestSuite>> {
    return this.createFromSeed({
      id: slugify(request.name),
      name: request.name,
      description: request.description ?? "",
      tagExpression: request.tagExpression,
    });
  }

  async createDefaults(): Promise<Result<TestSuite[]>> {
    const created: TestSuite[] = [];
    for (const seed of DEFAULT_SUITES) {
      const result = await this.createFromSeed(seed);
      if (!result.ok) return err(result.error);
      created.push(result.value);
    }
    return ok(created);
  }

  private async createFromSeed(seed: DefaultSuiteSeed): Promise<Result<TestSuite>> {
    const settings = await this.settingsService.load();
    const path = joinVaultPath(settings.paths.testSuitesPath, `${seed.name}.md`);
    const suite: TestSuite = {
      id: seed.id,
      name: seed.name,
      description: seed.description,
      tagExpression: seed.tagExpression,
      path,
    };

    if (!(await this.fs.exists(path))) {
      const created = await this.fs.createFile(path, buildSuiteNote(seed));
      if (!created.ok) {
        return err(
          appError("INIT_FAILED", `Could not write suite "${seed.name}".`, {
            cause: created.error,
          }),
        );
      }
    }

    await this.eventBus.publish(createEvent("suite.created", { suite }));
    return ok(suite);
  }
}
