<script setup lang="ts">
/**
 * The live output pane of the Test Console (ADR-0033 Phase 4). This is the ONE
 * surface the migration keeps IMPERATIVE on purpose: a run streams tens of
 * thousands of lines, so the pane appends each line straight into its own
 * `<pre>` rather than re-rendering a reactive list on every event (the ADR gate
 * — "preserve the stream, not a whole-view re-render"). The component owns the
 * element via a template ref and exposes append/clear to its parent, which calls
 * them from the `testrun.*` bus handlers.
 *
 * Behaviour preserved verbatim from the hand-rolled view: stderr lines carry a
 * distinct class, the retained DOM is bounded (drop the oldest beyond the cap),
 * and a new line auto-scrolls only when the user is already pinned to the bottom
 * — so scrolling back through earlier output is never yanked.
 */
import { ref } from "vue";
import { formatOutputLine } from "../../views/test-console-format";

/**
 * Cap on retained output lines. A long-running suite can stream tens of
 * thousands of lines; without a bound each becomes a permanent `<div>` and the
 * DOM grows without limit. Keep the most recent {@link MAX_OUTPUT_LINES} and
 * drop the oldest beyond that (PRES-M4).
 */
const MAX_OUTPUT_LINES = 5000;
/** Slack (px) within which the viewport counts as "pinned to the bottom". */
const PIN_SLACK_PX = 4;

const pre = ref<HTMLPreElement | null>(null);

const isPinnedToBottom = (el: HTMLElement): boolean =>
  el.scrollHeight - el.scrollTop - el.clientHeight < PIN_SLACK_PX;

const capLines = (el: HTMLElement): void => {
  while (el.childElementCount > MAX_OUTPUT_LINES) el.firstElementChild?.remove();
};

const appendDiv = (cls?: string): HTMLDivElement | null => {
  const el = pre.value;
  if (el === null) return null;
  const div = document.createElement("div");
  if (cls !== undefined) div.className = cls;
  el.appendChild(div);
  return div;
};

/** The `$ command` header written when a run starts; always scrolls into view. */
const appendCommand = (command: string): void => {
  const div = appendDiv("e2e-test-hub-console-cmd");
  if (div === null || pre.value === null) return;
  div.textContent = `$ ${command}`;
  pre.value.scrollTop = pre.value.scrollHeight;
};

/** One streamed line: stderr-styled, bounded by the cap, scroll-pinned. */
const appendLine = (stream: "stdout" | "stderr", line: string): void => {
  const el = pre.value;
  if (el === null) return;
  const pinned = isPinnedToBottom(el);
  const div = appendDiv(stream === "stderr" ? "e2e-test-hub-console-stderr" : undefined);
  if (div === null) return;
  div.textContent = formatOutputLine(stream, line);
  capLines(el);
  if (pinned) el.scrollTop = el.scrollHeight;
};

/** Clears the output pane only; the banner (last outcome) is the parent's. */
const clear = (): void => {
  pre.value?.replaceChildren();
};

defineExpose({ appendCommand, appendLine, clear });
</script>

<template>
  <!-- role="log" (NOT aria-live): a log implies polite, additions-only live
       semantics — an explicit aria-live on this high-frequency stream would spam
       screen readers with every output line. -->
  <pre ref="pre" class="e2e-test-hub-console-output" role="log"></pre>
</template>
