import { buildPersonaNote, parsePersonaNote, personaFileName } from "../content/persona-content";
import type { VaultFileSystem } from "../ports/vault-file-system";
import { collectReadableMarkdown } from "./markdown-notes";
import type { SettingsService } from "./settings-service";
import { type Persona, type PersonaId, nextPersonaId } from "../../domain/entities/persona";
import { appError } from "../../shared/errors/errors";
import { createEvent } from "../../shared/event-bus/create-event";
import type { EventBus } from "../../shared/event-bus/event-bus";
import type { Logger } from "../../shared/logging/logger";
import { err, ok, type Result } from "../../shared/result/result";
import { joinVaultPath } from "../../shared/utils/vault-path";
import { KeyedSerialQueue } from "../../shared/async/serial-queue";

export interface CreatePersonaRequest {
  name: string;
  color?: string;
  body?: string;
}

export interface PersonaService {
  create(request: CreatePersonaRequest): Promise<Result<Persona>>;
  findAll(): Promise<Result<Persona[]>>;
  findById(id: PersonaId): Promise<Result<Persona | null>>;
  rename(id: PersonaId, name: string): Promise<Result<Persona>>;
  /**
   * Returns the existing persona whose (trimmed) name matches `name` exactly, or
   * creates one if none exists. Used by the Story Map service to materialize a
   * shared persona note per map user (ADR-0030). Blank names are rejected.
   */
  findOrCreateByName(name: string): Promise<Result<Persona>>;
}

/** Single key serializing persona id-allocation + creation (prevents duplicate ids). */
const PERSONA_MUTATE_KEY = "persona:mutate";

export class DefaultPersonaService implements PersonaService {
  // Serialize all note I/O per path to prevent lost-update races (mirrors
  // DefaultUseCaseService.noteWrites).
  private readonly noteWrites = new KeyedSerialQueue();

  constructor(
    private readonly settingsService: SettingsService,
    private readonly fs: VaultFileSystem,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {}

  async create(request: CreatePersonaRequest): Promise<Result<Persona>> {
    const name = request.name.trim();
    if (name === "") {
      return err(appError("VALIDATION_FAILED", "A Persona name is required."));
    }

    // Allocate the id AND write under one persona-wide key: keying the write by the
    // final path (which embeds the id) would not serialize two concurrent creates
    // with different names, so both could read the same `findAll()` and claim the
    // same PER-NNN, leaving the vault with duplicate ids (mirrors PrdService).
    return this.noteWrites.run(PERSONA_MUTATE_KEY, () =>
      this.createUnlocked(name, request.color, request.body),
    );
  }

  /**
   * The create body, assuming the caller already holds {@link PERSONA_MUTATE_KEY}.
   * Allocates the next id from the current vault state and writes the note. Callers
   * MUST run this inside `this.noteWrites.run(PERSONA_MUTATE_KEY, …)` (never re-enter
   * that key, which would deadlock the same-key chain) — see {@link findOrCreateByName}.
   */
  private async createUnlocked(
    name: string,
    color?: string,
    body?: string,
  ): Promise<Result<Persona>> {
    const settings = await this.settingsService.load();
    const existing = await this.findAll();
    if (!existing.ok) return err(existing.error);

    const id = nextPersonaId(existing.value);
    const path = joinVaultPath(settings.paths.personasPath, personaFileName(id, name));
    const persona: Persona = {
      id,
      name,
      color,
      body: body ?? "",
      path,
    };

    const created = await this.fs.createFile(path, buildPersonaNote(persona));
    if (!created.ok) return err(created.error);

    await this.eventBus.publish(
      createEvent("persona.created", { personaId: id, name, path }, { correlationId: id }),
    );
    this.logger.info("Persona created", { id, path });
    return ok(persona);
  }

  /**
   * Runs `fn` with the current persona list under the persona-wide mutation key, so
   * a find/check + create/write is one atomic step against concurrent persona
   * mutations. Callers must NOT re-enter the key (e.g. via `this.create`); call
   * `createUnlocked` directly — re-entering would deadlock the same-key serial chain.
   */
  private withPersonaList<T>(fn: (personas: Persona[]) => Promise<Result<T>>): Promise<Result<T>> {
    return this.noteWrites.run(PERSONA_MUTATE_KEY, async () => {
      const all = await this.findAll();
      if (!all.ok) return err(all.error);
      return fn(all.value);
    });
  }

  async findOrCreateByName(name: string): Promise<Result<Persona>> {
    const trimmed = name.trim();
    if (trimmed === "") {
      return err(appError("VALIDATION_FAILED", "A Persona name is required."));
    }
    // Find-then-maybe-create under ONE hold of the persona-wide key so two
    // concurrent calls for the same name can't both miss the find and create
    // duplicate notes.
    return this.withPersonaList(async (personas) => {
      const match = personas.find((p) => p.name === trimmed);
      if (match) return ok(match);
      return this.createUnlocked(trimmed);
    });
  }

  async findAll(): Promise<Result<Persona[]>> {
    const settings = await this.settingsService.load();
    const listed = await this.fs.listFilesRecursive(settings.paths.personasPath);
    if (!listed.ok) {
      const messageLC = listed.error.message.toLowerCase();
      if (messageLC.includes("enoent") || messageLC.includes("not found")) return ok([]);
      return listed;
    }

    const personas = await collectReadableMarkdown(
      this.fs,
      listed.value,
      (path, content) => parsePersonaNote(content, path) ?? undefined,
    );
    personas.sort((a, b) => a.id.localeCompare(b.id));
    return ok(personas);
  }

  async findById(id: PersonaId): Promise<Result<Persona | null>> {
    const all = await this.findAll();
    if (!all.ok) return err(all.error);
    return ok(all.value.find((p) => p.id === id) ?? null);
  }

  /**
   * Renames a persona: rewrites `name` frontmatter + H1 in place. The file path
   * is NOT renamed — it is id-stable so any references (Story Map cards) keep
   * resolving. Publishes `persona.updated`.
   */
  async rename(id: PersonaId, name: string): Promise<Result<Persona>> {
    const trimmed = name.trim();
    if (trimmed === "") {
      return err(appError("VALIDATION_FAILED", "A Persona name is required."));
    }

    // Serialize under the persona-wide key (like create/findOrCreateByName) so the
    // duplicate-name check + write is atomic against concurrent creates/renames.
    // Otherwise two notes could end up with the same `name`, and findOrCreateByName
    // (first sorted id wins) would later resolve a Story Map user to the wrong one.
    return this.withPersonaList(async (personas) => {
      const target = personas.find((p) => p.id === id);
      if (target === undefined) {
        return err(appError("VALIDATION_FAILED", `Unknown Persona: ${id}`));
      }
      if (personas.some((p) => p.id !== id && p.name === trimmed)) {
        return err(appError("VALIDATION_FAILED", `A Persona named "${trimmed}" already exists.`));
      }

      const updated: Persona = { ...target, name: trimmed };
      const written = await this.fs.writeFile(target.path, buildPersonaNote(updated));
      if (!written.ok) return err(written.error);

      await this.eventBus.publish(
        createEvent(
          "persona.updated",
          { personaId: id, name: trimmed, path: target.path },
          { correlationId: id },
        ),
      );
      this.logger.info("Persona renamed", { id, name: trimmed });
      return ok(updated);
    });
  }
}
