import { buildSuiteNote, DEFAULT_SUITES, type DefaultSuiteSeed } from "../content/default-suites";
import { slugify } from "../content/feature-content";
// Suite filenames need exactly the Use Case note-name rule (strip path
// separators / filename-reserved chars, collapse spaces) — reuse it.
import { sanitizeTitle as sanitizeFileName } from "../content/use-case-content";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { SettingsService } from "./settings-service";
import { createSuite, type TestSuite } from "../../domain/entities/suite";
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
 * An on-disk `test-suite` note as seen by the full index: its declared `id` and
 * `path` always, plus the parsed {@link TestSuite} when valid (`null` when the
 * note is malformed, e.g. missing tag_expression). Lets creation reason about
 * malformed notes that findAll() deliberately omits.
 */
interface SuiteNote {
  id: SuiteId;
  path: VaultPath;
  suite: TestSuite | null;
}

/**
 * Suite lifecycle (TIS §8.8). Sprint 1 implements the creation surface the
 * Initialization Wizard needs; EPIC-006 adds the read/index methods
 * (`findAll`, `resolveTagExpression`) for Test Suite Management.
 */
export interface SuiteService {
  create(request: CreateSuiteRequest): Promise<Result<TestSuite>>;
  /**
   * @param correlationId optional init/reset flow id stamped onto the
   * `suite.created` events so a wizard run's events share one id (§19, RV-1).
   */
  createDefaults(correlationId?: string): Promise<Result<TestSuite[]>>; // Smoke + Regression per G1
  findAll(): Promise<Result<TestSuite[]>>; // US-024/US-025 visibility, UC-008
  resolveTagExpression(suiteId: SuiteId): Promise<Result<string>>; // per AD-4
}

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
        appError(
          "VALIDATION_FAILED",
          "A suite name with at least one letter or digit is required.",
        ),
      );
    }
    // Membership/scope IS the tag expression (AD-4); a blank one resolves to ""
    // and would run nothing meaningful. This invariant is enforced by the
    // createSuite() factory (via createFromSeed below, ADR-0011), so the rule
    // lives in one place — but check it up front too to fail before the
    // (more expensive) duplicate-id scan and to report the cleanest error.
    if (request.tagExpression.trim() === "") {
      return err(appError("VALIDATION_FAILED", "A suite tag expression is required."));
    }
    // "create" mode rejects a duplicate id ANYWHERE (incl. an existing valid
    // suite at the target path, or a malformed same-id note findAll() hides);
    // createFromSeed scans the full on-disk index for this.
    return this.createFromSeed(
      {
        id,
        name,
        // Collapse newlines: frontmatter `description` is a single-line scalar.
        description: request.description?.replace(/\s+/g, " ").trim() ?? "",
        tagExpression: request.tagExpression.trim(),
      },
      "create",
    );
  }

  async createDefaults(correlationId?: string): Promise<Result<TestSuite[]>> {
    const created: TestSuite[] = [];
    for (const seed of DEFAULT_SUITES) {
      // "seed" mode is idempotent: an already-present default suite is kept (not
      // a duplicate error), so re-running init / a UC-024 reset is safe.
      const result = await this.createFromSeed(seed, "seed", correlationId);
      if (!result.ok) return err(result.error);
      created.push(result.value);
    }
    return ok(created);
  }

  /** Indexes every VALID `test-suite` note under the suites folder (UC-008, best-effort). */
  async findAll(): Promise<Result<TestSuite[]>> {
    const indexed = await this.indexSuiteNotes();
    if (!indexed.ok) return err(indexed.error);
    const suites = indexed.value
      .filter((note): note is SuiteNote & { suite: TestSuite } => note.suite !== null)
      .map((note) => note.suite);
    suites.sort((a, b) => a.id.localeCompare(b.id));
    return ok(suites);
  }

  /**
   * Indexes EVERY `test-suite` note (valid AND malformed) with its id and path.
   * findAll() exposes only the valid ones, but creation needs the full picture:
   * a malformed same-id note (P3-2 hides it from findAll) must still block a
   * duplicate id and be recognised at the target path (review). Best-effort:
   * unreadable notes and non-suite notes are skipped.
   */
  private async indexSuiteNotes(): Promise<Result<SuiteNote[]>> {
    const settings = await this.settingsService.load();
    // Recurse so suites organised into subfolders are indexed (parity with
    // UseCaseService.findAll, so resolveTagExpression can't miss a real suite).
    const listed = await this.fs.listFilesRecursive(settings.paths.testSuitesPath);
    if (!listed.ok) return err(listed.error);

    const notes: SuiteNote[] = [];
    for (const path of listed.value) {
      if (!path.endsWith(".md")) continue;
      const read = await this.fs.readFile(path);
      if (!read.ok) continue; // index is best-effort; skip unreadable notes
      const fm = parseFrontmatter(read.value);
      if (fm.type !== "test-suite" || typeof fm.id !== "string") continue;
      notes.push({ id: fm.id, path, suite: this.parse(read.value, path) });
    }
    return ok(notes);
  }

  /**
   * Returns a suite's tag expression verbatim (AD-4): this is the exact
   * `BDD_TAGS` value a run applies, so it is never rewritten (e.g. no implicit
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
    // Route through the invariant-enforcing factory (ADR-0011): a suite note
    // with no `tag_expression` is malformed — skip it rather than index a suite
    // whose tag expression is "" (which would resolve to nothing). The index is
    // best-effort, so a rejected suite is simply omitted.
    const built = createSuite({
      id: fm.id,
      name: typeof fm.title === "string" ? fm.title : fm.id,
      description: typeof fm.description === "string" ? fm.description : undefined,
      tagExpression: typeof fm.tag_expression === "string" ? fm.tag_expression : "",
      path,
    });
    return built.ok ? built.value : null;
  }

  private async createFromSeed(
    seed: DefaultSuiteSeed,
    mode: "create" | "seed",
    correlationId?: string,
  ): Promise<Result<TestSuite>> {
    const settings = await this.settingsService.load();
    // Sanitize the filename segment (preserve the display title in frontmatter)
    // so a name with "/" or reserved chars can't create subfolders or fail.
    const path = joinVaultPath(settings.paths.testSuitesPath, `${sanitizeFileName(seed.name)}.md`);
    // Enforce the suite invariants (non-empty name + tag expression, ADR-0011)
    // at construction. create() already screens user input, but routing every
    // construction site through the factory keeps the rule in exactly one place.
    const builtSuite = createSuite({
      id: seed.id,
      name: seed.name,
      description: seed.description,
      tagExpression: seed.tagExpression,
      path,
    });
    if (!builtSuite.ok) return err(builtSuite.error);
    const suite = builtSuite.value;

    // Index every test-suite note (valid AND malformed) so creation sees the
    // complete on-disk picture — findAll() alone hides malformed notes (P3-2).
    const indexed = await this.indexSuiteNotes();
    if (!indexed.ok) return err(indexed.error);

    // Reject a duplicate id ANYWHERE in the vault — including a malformed same-id
    // note at a different path (review). Two notes sharing an id make
    // resolveTagExpression ambiguous and leave identity ambiguous once repaired.
    const dupElsewhere = indexed.value.find((n) => n.id === suite.id && n.path !== path);
    if (dupElsewhere) {
      return err(
        appError(
          "VALIDATION_FAILED",
          `A Test Suite with id "${suite.id}" already exists (at "${dupElsewhere.path}").`,
        ),
      );
    }

    // Decide what to do with whatever occupies the TARGET path:
    //  - nothing            → create.
    //  - a VALID same-id    → in "create" mode this is a duplicate → reject; in
    //    suite                "seed" mode it's idempotent re-seeding → skip.
    //  - this same suite,   → repair (overwrite the malformed note with valid
    //    malformed             content so resolveTagExpression can find it).
    //  - any OTHER note     → refuse, never clobber (a different/absent-id suite
    //    (incl. non-suite)     note, or a non-suite note — review P2).
    const atTarget = indexed.value.find((n) => n.path === path);
    const occupiedByForeign = (await this.fs.exists(path)) && !atTarget; // non-suite note at path
    if (occupiedByForeign || (atTarget?.suite === null && atTarget.id !== suite.id)) {
      return err(
        appError(
          "VALIDATION_FAILED",
          `A different note already exists at "${path}"; ` +
            `rename it or choose a different suite name.`,
        ),
      );
    }
    if (mode === "create" && atTarget && atTarget.suite !== null) {
      // A valid suite with this id is already on disk — a user "create" must not
      // silently overwrite it (its on-disk tag expression would diverge from the
      // returned one), so reject as a duplicate. (createDefaults uses "seed" mode
      // and skips instead — idempotent re-seeding.)
      return err(
        appError("VALIDATION_FAILED", `A Test Suite with id "${suite.id}" already exists.`),
      );
    }
    if (!atTarget?.suite) {
      // A foreign note at the path was already refused above, so here the path is
      // either empty (create) or holds this same suite's malformed note (repair).
      const written = atTarget
        ? await this.fs.writeFile(path, buildSuiteNote(seed))
        : await this.fs.createFile(path, buildSuiteNote(seed));
      if (!written.ok) {
        return err(
          appError("INIT_FAILED", `Could not write suite "${seed.name}".`, {
            cause: written.error,
          }),
        );
      }
    }

    await this.eventBus.publish(
      createEvent(
        "suite.created",
        {
          suiteId: suite.id,
          name: suite.name,
          path: suite.path,
          tagExpression: suite.tagExpression,
        },
        { correlationId },
      ),
    );
    return ok(suite);
  }
}
