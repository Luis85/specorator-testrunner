import { parseFeature } from "../content/gherkin";
import type { VaultFileSystem } from "../ports/vault-file-system";
import type { FeatureSpecification } from "../../domain/entities/specification";
import type { VaultPath } from "../../domain/value-objects/identifiers";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * Reads a single `.feature` file and parses it, failing with the read error
 * when the file is unreadable and a VALIDATION_FAILED error when its contents
 * are not valid Gherkin. The single-feature counterpart to the best-effort
 * corpus loaders (which skip bad files rather than error).
 */
export const readFeatureFile = async (
  fs: VaultFileSystem,
  featurePath: VaultPath,
): Promise<Result<FeatureSpecification>> => {
  const read = await fs.readFile(featurePath);
  if (!read.ok) return err(read.error);
  const feature = parseFeature(read.value, featurePath);
  if (feature === null) {
    return err(appError("VALIDATION_FAILED", `"${featurePath}" is not a valid Feature.`));
  }
  return ok(feature);
};
