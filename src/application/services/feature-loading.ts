import { parseFeature } from "../content/gherkin";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { FeatureSpecification } from "../../domain/entities/specification";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/** A `.feature` file's raw bytes alongside its parsed spec, from ONE read. */
export interface FeatureFileRead {
  /**
   * Raw, unparsed file content — the #77 coverage cache's content-address
   * input (spec D6): a Scenario Outline Examples-row/Background/comment edit
   * changes these bytes (and what bddgen evaluates) even when the PARSED step
   * templates {@link FeatureSpecification.scenarios} sees don't.
   */
  content: string;
  feature: FeatureSpecification;
}

/**
 * Reads a single `.feature` file and returns BOTH its raw content and parsed
 * spec from ONE read — a caller that needs the raw bytes for content-
 * addressing (the #77 coverage cache) as well as the parsed steps uses this
 * instead of reading the file twice. Fails with the read error when the file
 * is unreadable and a VALIDATION_FAILED error when its contents are not valid
 * Gherkin — the same failure modes {@link readFeatureFile} has always had.
 */
export const readFeatureFileWithSource = async (
  // Only `readFile` is used — the narrow slice lets a caller with a minimal fs
  // slice (e.g. the Pending Steps panel's deps) reuse this; a full
  // VaultFileSystem still satisfies it structurally (same idiom as
  // loadStepDefinitions).
  fs: Pick<VaultFileSystem, "readFile">,
  featurePath: VaultPath,
): Promise<Result<FeatureFileRead>> => {
  const read = await fs.readFile(featurePath);
  if (!read.ok) return err(read.error);
  const feature = parseFeature(read.value, featurePath);
  if (feature === null) {
    return err(appError("VALIDATION_FAILED", `"${featurePath}" is not a valid Feature.`));
  }
  return ok({ content: read.value, feature });
};

/**
 * Reads a single `.feature` file and parses it, failing with the read error
 * when the file is unreadable and a VALIDATION_FAILED error when its contents
 * are not valid Gherkin. The single-feature counterpart to the best-effort
 * corpus loaders (which skip bad files rather than error). A thin delegate
 * over {@link readFeatureFileWithSource} for the (majority of) callers that
 * only need the parsed spec, not the raw bytes.
 */
export const readFeatureFile = async (
  fs: Pick<VaultFileSystem, "readFile">,
  featurePath: VaultPath,
): Promise<Result<FeatureSpecification>> => {
  const read = await readFeatureFileWithSource(fs, featurePath);
  return read.ok ? ok(read.value.feature) : err(read.error);
};
