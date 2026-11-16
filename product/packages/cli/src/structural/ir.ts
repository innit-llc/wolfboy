/**
 * The normalised element IR every language adapter translates into.
 *
 * WHY IT EXISTS. A check written against this shape is written ONCE and works in every language an
 * adapter exists for. The line-based reading has the opposite shape: each check is re-expressed per
 * language, which is how `eu-accessibility-001` arrived at fourteen patterns for six checks.
 *
 * WHAT IT MAY NOT DO. Every `line` here is a 1-based line of the ORIGINAL file, and nothing in this
 * module or in any adapter may produce a number that is not. That is the same constraint derive.ts
 * states for its views ("REPORTED LINE NUMBERS MUST NOT MOVE"), and it is why the masking adapters
 * blank template regions in place instead of removing them: byte offsets and newlines survive, so a
 * position reported by the parser is a position in the file the user has open.
 *
 * Ported from `product/pilot-structural/src/ir.mjs`, which is a prototype and not a dependency.
 */

export interface IrAttr {
  name: string;
  /** The literal value, or null when the adapter could see the attribute but not its value. */
  value: string | null;
  /** True when the value is an expression rather than literal text, so its content is unknowable. */
  dynamic: boolean;
}

export interface IrElement {
  kind: "element";
  /** null for a JSX fragment and for the object-literal form of check (C). */
  tag: string | null;
  /** 1-based line the element STARTS on, directly comparable with a line-based location. */
  line: number;
  /**
   * Last line of the element's OPENING construct. An attribute written on a later line than its tag
   * belongs to the same finding as the tag; a reader handed only the first line of a wrapped element
   * is reading half a sentence, which is why this reaches `FindingLocation.end_line`.
   */
  endLine: number;
  attrs: IrAttr[];
  /**
   * True when the element carries an attribute bag this adapter cannot read: a JSX spread, a Vue
   * `v-bind="obj"`, a HAML `{ html_attributes }`. Absence of an attribute is then not decidable, and
   * EVERY check that turns on absence must decline rather than report.
   */
  opaqueAttrs: boolean;
  children: IrNode[];
}

export interface IrText {
  kind: "text";
  content: string;
  line: number;
  children: IrNode[];
}

/**
 * A dynamic expression that renders text: HAML `= t(...)`, ERB `<%= ... %>`, `{{ x }}`, JSX
 * `{label}`. Treated as a name, because nothing here can know it renders empty and reporting it
 * would be reporting a guess.
 */
export interface IrExpr {
  kind: "expr";
  line: number;
  children: IrNode[];
}

export type IrNode = IrElement | IrText | IrExpr;

export function el(
  tag: string | null,
  line: number,
  opts: Partial<Pick<IrElement, "endLine" | "attrs" | "opaqueAttrs" | "children">> = {},
): IrElement {
  return {
    kind: "element",
    tag: tag === null ? null : String(tag),
    line,
    endLine: opts.endLine ?? line,
    attrs: opts.attrs ?? [],
    opaqueAttrs: opts.opaqueAttrs ?? false,
    children: opts.children ?? [],
  };
}

export function text(content: string, line: number): IrText {
  return { kind: "text", content, line, children: [] };
}

export function expr(line: number): IrExpr {
  return { kind: "expr", line, children: [] };
}

export function attr(name: string, value: string | null, dynamic = false): IrAttr {
  return { name, value, dynamic };
}

/**
 * Strip the binding prefix a framework puts in front of an ordinary attribute name: Vue's `:alt` and
 * `v-bind:alt`, Svelte's `bind:`, Alpine's `x-bind:`, Handlebars' `@tabindex`. The attribute being
 * bound is still that attribute, and a check asking whether `alt` is present must see it. Handler
 * names never come through here — they go through `anyAttr` on the raw name — so `@click` is
 * untouched.
 */
export const bareName = (name: string): string =>
  name.toLowerCase().replace(/^(v-bind:|x-bind:|bind:|[@:])/, "");

export function getAttr(node: IrElement, name: string): IrAttr | null {
  const want = name.toLowerCase();
  return node.attrs.find((a) => bareName(a.name) === want) ?? null;
}

export function hasAttr(node: IrElement, name: string): boolean {
  return getAttr(node, name) !== null;
}

/**
 * Whether any attribute name satisfies a predicate — used for handler families, whose names carry
 * framework prefixes and modifiers (`on:click|stopPropagation`, `@click.stop`).
 */
export function anyAttr(node: IrElement, pred: (lowerName: string, a: IrAttr) => boolean): boolean {
  return node.attrs.some((a) => pred(a.name.toLowerCase(), a));
}

export function* walk(nodes: IrNode[]): Generator<IrNode> {
  for (const n of nodes) {
    yield n;
    if (n.children.length) yield* walk(n.children);
  }
}

export function* descendants(node: IrNode): Generator<IrNode> {
  for (const c of node.children) {
    yield c;
    yield* descendants(c);
  }
}
