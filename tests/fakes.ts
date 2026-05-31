import type { AbsoluteFileSystem } from "../src/application/ports/absolute-file-system";
import type {
  ChildProcessRunner,
  RunCommandRequest,
  RunnerCommandResult,
  RunnerOutput,
} from "../src/application/ports/child-process-runner";
import type { DataStore } from "../src/application/ports/data-store";
import type {
  TemplateWriteRequest,
  TemplateWriteResult,
  TemplateWriter,
} from "../src/application/ports/template-writer";
import type { VaultFileSystem } from "../src/application/ports/vault-file-system";
import type { VaultPath } from "../src/domain/value-objects/identifiers";
import { joinVaultPath } from "../src/shared/utils/vault-path";
import type {
  DomainEvent,
  DomainEventType,
} from "../src/domain/events/domain-event";
import { InMemoryEventBus } from "../src/shared/event-bus/event-bus";
import type { Logger } from "../src/shared/logging/logger";
import { ok, type Result } from "../src/shared/result/result";

/** No-op {@link Logger} for tests. */
export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** In-memory {@link VaultFileSystem} for application/integration tests. */
export class FakeVaultFileSystem implements VaultFileSystem {
  readonly files = new Map<VaultPath, string>();
  readonly folders = new Set<VaultPath>();
  failOn?: { path: VaultPath; message: string };

  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async createFolder(path: VaultPath): Promise<Result<void>> {
    this.folders.add(path);
    return ok(undefined);
  }

  async createFile(path: VaultPath, content: string): Promise<Result<void>> {
    if (this.failOn && this.failOn.path === path) {
      return { ok: false, error: { code: "INIT_FAILED", message: this.failOn.message } };
    }
    this.files.set(path, content);
    return ok(undefined);
  }

  async writeFile(path: VaultPath, content: string): Promise<Result<void>> {
    if (this.failOn && this.failOn.path === path) {
      return { ok: false, error: { code: "INIT_FAILED", message: this.failOn.message } };
    }
    this.files.set(path, content);
    return ok(undefined);
  }

  async readFile(path: VaultPath): Promise<Result<string>> {
    const content = this.files.get(path);
    if (content === undefined) {
      return { ok: false, error: { code: "RUNNER_MISSING_FILE", message: `missing ${path}` } };
    }
    return ok(content);
  }

  async listFiles(path: VaultPath): Promise<Result<VaultPath[]>> {
    // Immediate children only, mirroring the Obsidian adapter (non-recursive).
    const prefix = `${path}/`;
    return ok(
      [...this.files.keys()].filter(
        (p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"),
      ),
    );
  }

  async listFilesRecursive(path: VaultPath): Promise<Result<VaultPath[]>> {
    return ok([...this.files.keys()].filter((p) => p.startsWith(`${path}/`)));
  }
}

/** In-memory {@link DataStore}. */
export class FakeDataStore implements DataStore {
  constructor(private data: unknown = undefined) {}

  async load(): Promise<unknown> {
    return this.data;
  }

  async save(data: unknown): Promise<void> {
    this.data = data;
  }
}

/** In-memory {@link AbsoluteFileSystem}. */
export class FakeAbsoluteFileSystem implements AbsoluteFileSystem {
  readonly written = new Map<string, string>();
  readonly existing = new Set<string>();
  basePath: string | null = "/vault";

  async getVaultBasePath(): Promise<Result<string>> {
    if (this.basePath === null) {
      return { ok: false, error: { code: "INIT_FAILED", message: "no base path" } };
    }
    return ok(this.basePath);
  }

  /** Seeds file contents so {@link readAbsolute} can serve them (e.g. a report). */
  seed(path: string, content: string): void {
    this.written.set(path, content);
    this.existing.add(path);
  }

  async existsAbsolute(path: string): Promise<boolean> {
    return this.existing.has(path) || this.written.has(path);
  }

  async readAbsolute(path: string): Promise<Result<string>> {
    const content = this.written.get(path);
    if (content === undefined) {
      return { ok: false, error: { code: "REPORT_NOT_FOUND", message: `missing ${path}` } };
    }
    return ok(content);
  }

  async writeAbsolute(path: string, content: string): Promise<Result<void>> {
    this.written.set(path, content);
    this.existing.add(path);
    return ok(undefined);
  }

  async listAbsolute(path: string): Promise<string[]> {
    const prefix = `${path}/`;
    const children = new Set<string>();
    for (const candidate of [...this.existing, ...this.written.keys()]) {
      if (candidate.startsWith(prefix)) {
        children.add(candidate.slice(prefix.length).split("/")[0]);
      }
    }
    return [...children];
  }
}

/** Scriptable {@link ChildProcessRunner}: matches commands by substring. */
export class FakeChildProcessRunner implements ChildProcessRunner {
  readonly calls: RunCommandRequest[] = [];
  /** command-substring → exit code (default 0). */
  readonly exitCodes = new Map<string, number>();
  /** command substrings whose spawn should fail outright. */
  readonly spawnFailures = new Set<string>();
  /** Lines streamed via `onOutput` before a streaming run resolves. */
  readonly streamLines: RunnerOutput[] = [];
  /** process ids passed to `cancel`. */
  readonly cancelled: string[] = [];
  /**
   * When true, `runStreaming` does not resolve until {@link release} is called.
   * Lets tests overlap a second `execute()` or `cancel()` against an in-flight
   * run deterministically (no real timers).
   */
  pending = false;
  /**
   * Pre-armed gate so {@link release} works even if it is called before
   * `runStreaming` reaches the await — mirrors a child that is killed the
   * instant it spawns.
   */
  private gate = this.makeGate();
  private released = false;

  async run(request: RunCommandRequest): Promise<Result<RunnerCommandResult>> {
    this.calls.push(request);
    return this.settle(request);
  }

  async runStreaming(
    request: RunCommandRequest,
    onOutput: (output: RunnerOutput) => void,
  ): Promise<Result<RunnerCommandResult>> {
    this.calls.push(request);
    for (const line of this.streamLines) onOutput(line);
    if (this.pending && !this.released) await this.gate.promise;
    return this.settle(request);
  }

  /** Unblocks a `pending` streaming run so its promise resolves. */
  release(): void {
    this.released = true;
    this.gate.resolve();
  }

  private makeGate(): { promise: Promise<void>; resolve: () => void } {
    let resolve = (): void => {};
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  }

  async cancel(processId: string): Promise<Result<void>> {
    this.cancelled.push(processId);
    this.release();
    return ok(undefined);
  }

  private settle(request: RunCommandRequest): Result<RunnerCommandResult> {
    // Match on the joined argv (the runner spawns with shell: false; the PR #7
    // rework to argv arrays), so test fixtures still match by command substring.
    const command = request.args.join(" ");
    for (const fragment of this.spawnFailures) {
      if (command.includes(fragment)) {
        return { ok: false, error: { code: "INIT_FAILED", message: "spawn failed" } };
      }
    }
    let exitCode = 0;
    for (const [fragment, code] of this.exitCodes) {
      if (command.includes(fragment)) exitCode = code;
    }
    return ok({ exitCode, stdout: "", stderr: exitCode === 0 ? "" : "boom", durationMs: 1 });
  }
}

/** {@link TemplateWriter} that reports every template as written. */
export class FakeTemplateWriter implements TemplateWriter {
  readonly requests: TemplateWriteRequest[] = [];
  fail = false;

  async writeTemplates(request: TemplateWriteRequest): Promise<Result<TemplateWriteResult>> {
    this.requests.push(request);
    if (this.fail) {
      return { ok: false, error: { code: "INIT_FAILED", message: "template write failed" } };
    }
    return ok({
      writtenFiles: request.templates.map((t) => joinVaultPath(request.targetPath, t.path)),
      skippedFiles: [],
    });
  }
}

/** Wraps {@link InMemoryEventBus} and records every published event. */
export const recordingEventBus = (): {
  bus: InMemoryEventBus;
  events: DomainEvent[];
  types: () => DomainEventType[];
} => {
  const events: DomainEvent[] = [];
  const bus = new InMemoryEventBus();
  const originalPublish = bus.publish.bind(bus);
  bus.publish = async <T>(event: DomainEvent<T>) => {
    events.push(event as DomainEvent);
    return originalPublish(event);
  };
  return { bus, events, types: () => events.map((event) => event.type) };
};
