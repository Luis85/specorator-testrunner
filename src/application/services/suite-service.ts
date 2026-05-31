import {
  buildSuiteNote,
  DEFAULT_SUITES,
  type DefaultSuiteSeed,
} from "../content/default-suites";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SettingsService } from "./settings-service";
import type { TestSuite } from "../../domain/entities/suite";
import type { SuiteId, VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import { parseFrontmatter } from "../../shared/utils/frontmatter";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath } from "../../shared/utils/vault-path";

export interface CreateSuiteRequest {
  name: string;
  description?: string;
  tagExpression: string;
}

/**
 * Suite lifecycle (TIS §8.8). Sprint 1 implements the creation surface the
 * Initialization Wizard needs; EPIC-006 adds the read/index methods
 * (`findAll`, `resolveTagExpression`) for Test Suite Management.
 */
export interface SuiteService {
  create(request: CreateSuiteRequest): Promise<Result<TestSuite>>;
  createDefaults(): Promise<Result<TestSuite[]>>; // Smoke + Regression per G1
  findAll(): Promise<Result<TestSuite[]>>; // US-024/US-025 visibility, UC-008
  resolveTagExpression(suiteId: SuiteId): Promise<Result<string>>; // per AD-4
}

const slugify = (name: string): SuiteId =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Strips path separators / filename-reserved chars from a note filename. */
const sanitizeFileName = (name: string): string =>
  name
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export class DefaultSuiteService implements SuiteService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
  ) {}

  async create(request: CreateSuiteRequest): Promise<Result<TestSuite>> {
    const name = request.name.trim();
    const id = slugify(name);
    if (id === "") {
      return err(
        appError("VALIDATION_FAILED", "A suite name with at least one letter or digit is required."),
      );
    }
    // Membership/scope IS the tag expression (AD-4); a blank one resolves to ""
    // and would run nothing meaningful, so reject it up front.
    if (request.tagExpression.trim() === "") {
      return err(appError("VALIDATION_FAILED", "A suite tag expression is required."));
    }
    // Reject a duplicate id: two notes sharing an id make resolveTagExpression
    // ambiguous (it would pick whichever sorts first).
    const existing = await this.findAll();
    if (!existing.ok) return err(existing.error);
    if (existing.value.some((suite) => suite.id === id)) {
      return err(appError("VALIDATION_FAILED", `A Test Suite with id "${id}" already exists.`));
    }
    return this.createFromSeed({
      id,
      name,
      // Collapse newlines: frontmatter `description` is a single-line scalar.
      description: request.description?.replace(/\s+/g, " ").trim() ?? "",
      tagExpression: request.tagExpression.trim(),
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

  /** Indexes every `test-suite` note under the suites folder (UC-008, best-effort). */
  async findAll(): Promise<Result<TestSuite[]>> {
    const settings = await this.settingsService.load();
    // Recurse so suites organised into subfolders are indexed (parity with
    // UseCaseService.findAll, so resolveTagExpression can't miss a real suite).
    const listed = await this.fs.listFilesRecursive(settings.paths.testSuitesPath);
    if (!listed.ok) return err(listed.error);

    const suites: TestSuite[] = [];
    for (const path of listed.value) {
      if (!path.endsWith(".md")) continue;
      const read = await this.fs.readFile(path);
      if (!read.ok) continue; // index is best-effort; skip unreadable notes
      const suite = this.parse(read.value, path);
      if (suite) suites.push(suite);
    }
    suites.sort((a, b) => a.id.localeCompare(b.id));
    return ok(suites);
  }

  /**
   * Returns a suite's Cucumber tag expression verbatim (AD-4): this is the exact
   * `--tags` argument a run uses, so it is never rewritten (e.g. no implicit
   * `and not @wip`). Errors when no suite has the given id.
   */
  async resolveTagExpression(suiteId: SuiteId): Promise<Result<string>> {
    const all = await this.findAll();
    if (!all.ok) return err(all.error);
    const suite = all.value.find((candidate) => candidate.id === suiteId);
    if (!suite) {
      return err(appError("VALIDATION_FAILED", `No Test Suite found with id "${suiteId}".`));
    }
    return ok(suite.tagExpression);
  }

  /** Maps a note's frontmatter to a {@link TestSuite}; returns null if it is not one (TIS §10.2). */
  private parse(content: string, path: VaultPath): TestSuite | null {
    const fm = parseFrontmatter(content);
    if (fm.type !== "test-suite" || typeof fm.id !== "string") return null;
    return {
      id: fm.id,
      name: typeof fm.title === "string" ? fm.title : fm.id,
      description: typeof fm.description === "string" ? fm.description : undefined,
      tagExpression: typeof fm.tag_expression === "string" ? fm.tag_expression : "",
      path,
    };
  }

  private async createFromSeed(seed: DefaultSuiteSeed): Promise<Result<TestSuite>> {
    const settings = await this.settingsService.load();
    // Sanitize the filename segment (preserve the display title in frontmatter)
    // so a name with "/" or reserved chars can't create subfolders or fail.
    const path = joinVaultPath(settings.paths.testSuitesPath, `${sanitizeFileName(seed.name)}.md`);
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

    await this.eventBus.publish(
      createEvent("suite.created", {
        suiteId: suite.id,
        name: suite.name,
        path: suite.path,
        tagExpression: suite.tagExpression,
      }),
    );
    return ok(suite);
  }
}
