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
}

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

    const settings = await this.settingsService.load();
    const existing = await this.findAll();
    if (!existing.ok) return err(existing.error);

    const id = nextPersonaId(existing.value);
    const path = joinVaultPath(settings.paths.personasPath, personaFileName(id, name));
    const persona: Persona = {
      id,
      name,
      color: request.color,
      body: request.body ?? "",
      path,
    };

    const created = await this.noteWrites.run(path, () =>
      this.fs.createFile(path, buildPersonaNote(persona)),
    );
    if (!created.ok) return err(created.error);

    await this.eventBus.publish(
      createEvent("persona.created", { personaId: id, name, path }, { correlationId: id }),
    );
    this.logger.info("Persona created", { id, path });
    return ok(persona);
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

    const preLock = await this.findById(id);
    if (!preLock.ok) return err(preLock.error);
    if (preLock.value === null) {
      return err(appError("VALIDATION_FAILED", `Unknown Persona: ${id}`));
    }
    const notePath = preLock.value.path;

    return this.noteWrites.run(notePath, async () => {
      // Re-read inside the lock to get the freshest state.
      const fresh = await this.findById(id);
      if (!fresh.ok) return err(fresh.error);
      if (fresh.value === null) {
        return err(appError("VALIDATION_FAILED", `Unknown Persona: ${id}`));
      }
      const existing = fresh.value;

      // Rebuild the note from the current entity, swapping in the new name.
      const updated: Persona = { ...existing, name: trimmed };
      const content = buildPersonaNote(updated);
      const written = await this.fs.writeFile(notePath, content);
      if (!written.ok) return err(written.error);

      await this.eventBus.publish(
        createEvent(
          "persona.updated",
          { personaId: id, name: trimmed, path: notePath },
          { correlationId: id },
        ),
      );
      this.logger.info("Persona renamed", { id, name: trimmed });
      return ok(updated);
    });
  }
}
