import type { AppError } from "../../shared/errors/errors";

/** How many trailing output lines the failure box shows (the error is at the end). */
const FAILURE_OUTPUT_TAIL_LINES = 30;

/**
 * The TAIL of the failing child process's stderr from an init failure, or null
 * when the error carries none (non-process failures). Normalizes Windows CRLF,
 * drops blank edge lines, and keeps the LAST {@link FAILURE_OUTPUT_TAIL_LINES}
 * lines — npm prints the actual reason at the end. Pure (no Obsidian imports,
 * mirroring test-console-format) so the wizard's failure rendering rule is
 * unit-testable without a DOM.
 */
export const failureOutputTail = (failure: AppError): string | null => {
  const stderr = failure.details?.stderr;
  if (typeof stderr !== "string" || stderr.trim() === "") return null;
  const lines = stderr.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length === 0) return null;
  const tail = lines.slice(-FAILURE_OUTPUT_TAIL_LINES);
  const truncated = tail.length < lines.length;
  return (truncated ? "…\n" : "") + tail.join("\n");
};
