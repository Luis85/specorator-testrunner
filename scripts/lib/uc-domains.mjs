/**
 * Pure helpers for the Phase 1 Use Case domain analysis (PRD Creator, Task 17).
 *
 * Kept dependency-free and side-effect-free so they can be unit-tested without
 * touching the filesystem. The CLI wrapper (`scripts/analyze-uc-domains.mjs`)
 * does the I/O and delegates the grouping here.
 */

/**
 * Groups Use Case notes by their `domain`, returning one entry per distinct
 * domain with the Use Case ids that belong to it.
 *
 * Sort order: by group size descending, then by domain name ascending as a
 * stable tiebreak. Ids inside each group preserve input order.
 *
 * @param {{ id: string, domain: string }[]} notes
 * @returns {{ domain: string, ids: string[] }[]}
 */
export const groupByDomain = (notes) => {
  const byDomain = new Map();
  for (const note of notes) {
    const domain = note.domain;
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(note.id);
  }

  return [...byDomain.entries()]
    .map(([domain, ids]) => ({ domain, ids }))
    .sort((a, b) => b.ids.length - a.ids.length || a.domain.localeCompare(b.domain));
};

/**
 * Extracts the `domain:` value from a Markdown note's frontmatter via a simple
 * line scan. Returns an empty string when the field is absent. Only the first
 * `---` block is considered.
 *
 * @param {string} content
 * @returns {string}
 */
export const domainFromFrontmatter = (content) => {
  const normalised = content.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---/.exec(normalised);
  const block = match ? match[1] : normalised;
  for (const line of block.split("\n")) {
    const field = /^domain:\s*(.*)$/.exec(line);
    if (field) {
      const raw = field[1].trim();
      if (raw.startsWith('"')) {
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      }
      return raw;
    }
  }
  return "";
};
