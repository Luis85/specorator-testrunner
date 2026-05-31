import type { DataStore } from "../src/application/ports/data-store";
import type { VaultFileSystem } from "../src/application/ports/vault-file-system";
import type { VaultPath } from "../src/domain/value-objects/identifiers";
import type {
  DomainEvent,
  DomainEventType,
} from "../src/domain/events/domain-event";
import { InMemoryEventBus } from "../src/shared/event-bus/event-bus";
import { ok, type Result } from "../src/shared/result/result";

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
