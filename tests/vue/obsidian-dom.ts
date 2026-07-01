/**
 * Test-env polyfill for the Obsidian HTMLElement extensions (`createEl`,
 * `createDiv`, `createSpan`, `addClass`, `empty`, `setAttr`). Obsidian injects
 * these at runtime; they are NOT standard DOM, so the reused DOM writers
 * (`renderLoopRail`, `renderChecklist`, `renderLoadError`, `renderEmptyState`)
 * throw under happy-dom without them. Importing this module (in a happy-dom test)
 * installs the minimal subset those writers use. Idempotent.
 *
 * Assignments target a loosely-typed view of the prototype so they don't clash
 * with Obsidian's own (wider) global `HTMLElement` augmentation — this file only
 * provides the runtime the writers need under test.
 */

interface ElOptions {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null | undefined>;
}

function makeEl(parent: HTMLElement, tag: string, o?: ElOptions): HTMLElement {
  const el = document.createElement(tag);
  if (o?.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
  if (o?.text !== undefined) el.textContent = o.text;
  if (o?.attr) {
    for (const [key, value] of Object.entries(o.attr)) {
      if (value !== null && value !== undefined) el.setAttribute(key, String(value));
    }
  }
  parent.appendChild(el);
  return el;
}

const splitClasses = (classes: string[]): string[] =>
  classes.flatMap((c) => c.split(/\s+/)).filter(Boolean);

function installObsidianDom(): void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown> & {
    __obsidianDomPatched?: boolean;
  };
  if (proto.__obsidianDomPatched) return;
  proto.__obsidianDomPatched = true;

  proto.createEl = function (this: HTMLElement, tag: string, o?: ElOptions): HTMLElement {
    return makeEl(this, tag, o);
  };
  proto.createDiv = function (this: HTMLElement, o?: ElOptions): HTMLElement {
    return makeEl(this, "div", o);
  };
  proto.createSpan = function (this: HTMLElement, o?: ElOptions): HTMLElement {
    return makeEl(this, "span", o);
  };
  proto.addClass = function (this: HTMLElement, ...classes: string[]): void {
    this.classList.add(...splitClasses(classes));
  };
  proto.removeClass = function (this: HTMLElement, ...classes: string[]): void {
    this.classList.remove(...splitClasses(classes));
  };
  proto.setAttr = function (
    this: HTMLElement,
    name: string,
    value: string | number | boolean,
  ): void {
    this.setAttribute(name, String(value));
  };
  proto.empty = function (this: HTMLElement): void {
    this.replaceChildren();
  };
}

installObsidianDom();
