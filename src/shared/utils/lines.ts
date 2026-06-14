/**
 * Drops leading/trailing blank entries from a list of lines; interior blanks
 * survive (they are paragraph breaks the Gherkin model preserves). Returns an
 * empty array when every entry is blank.
 */
export const trimBlankEdges = (lines: string[]): string[] => {
  const start = lines.findIndex((line) => line !== "");
  if (start === -1) return [];
  let end = lines.length - 1;
  while (lines[end] === "") end -= 1;
  return lines.slice(start, end + 1);
};
