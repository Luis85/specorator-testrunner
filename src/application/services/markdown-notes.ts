import type { VaultFileSystem } from "../ports/vault-file-system";
import type { VaultPath } from "../../domain/value-objects/identifiers";

/**
 * Best-effort index over the recursively-listed `paths`: keeps only `.md`
 * files, reads each (silently skipping unreadable notes), and projects the
 * readable ones via `project`. A `project` result of `undefined` drops that
 * note from the output, so callers express their per-note filter as the
 * mapping itself. Order follows `paths`.
 */
export const collectReadableMarkdown = async <T>(
  fs: VaultFileSystem,
  paths: VaultPath[],
  project: (path: VaultPath, content: string) => T | undefined,
): Promise<T[]> => {
  const collected: T[] = [];
  for (const path of paths) {
    if (!path.endsWith(".md")) continue;
    const read = await fs.readFile(path);
    if (!read.ok) continue; // index is best-effort; skip unreadable notes
    const projected = project(path, read.value);
    if (projected !== undefined) collected.push(projected);
  }
  return collected;
};
