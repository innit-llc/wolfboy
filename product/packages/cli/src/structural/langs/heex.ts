/**
 * HEEx, and the HEEx templates written inside Elixir source as `~H` sigils.
 *
 * HEEX IS NOT A MASKED HOST LANGUAGE, which is the one thing to know before reading this file.
 * ERB and Blade need `langs/embedded.ts` because neither grammar models HTML: they can locate their
 * own constructs and nothing else, so the document has to be handed on to `parseHtml`.
 * `tree-sitter-heex` models the document itself — `tag`, `component`, `slot`, `start_tag`,
 * `attribute`, `text`, `expression` are all its own node types — so this adapter converts that tree
 * directly, exactly as `langs/html.ts` converts the HTML one, and no second grammar is involved.
 *
 * WHAT HEEX ADDS TO ANGLE-BRACKET MARKUP, and how each part reaches the IR:
 *
 *   - `<.input field={f[:email]} />` is a FUNCTION COMPONENT, and `<MyApp.Icons.spinner />` is the
 *     remote form of the same thing. Both become elements whose tag is the name AS WRITTEN — `.input`,
 *     `MyApp.Icons.spinner` — never the name with its dot removed, because `<.input>` is not `<input>`
 *     and reading it as one would put an HTML element in the tree that the file does not contain.
 *   - `<:col label="Name">` is a SLOT, and becomes an element tagged `:col`.
 *   - `{@rest}` written where an attribute goes is an attribute bag built elsewhere, and is the same
 *     construct as a JSX spread or a Vue `v-bind="obj"`. It sets `opaqueAttrs`, so every check that
 *     turns on the ABSENCE of an attribute declines on that element (`ir.ts`, `IrElement.opaqueAttrs`).
 *   - `{expr}` written where content goes RENDERS TEXT and becomes an `IrExpr`, as `<%= … %>` does in
 *     ERB. HEEx also still accepts EEx `<% … %>` directives, and those are read the same way ERB reads
 *     them: `<%= …` renders and `<% …` does not.
 *   - `:let`, `:for`, `:key`, `:stream` and `:if` are LiveView control-flow attributes. They are
 *     recorded with the names they are written with, because they ARE attributes of that element and
 *     dropping them would make the IR say the element has fewer than it has.
 *
 * ONE MAPPING IS WORTH STATING BECAUSE IT IS NOT OBVIOUS AND IS CURRENTLY HARMLESS. `ir.ts`'s
 * `bareName` strips a leading `:` from an attribute name, because in Vue `:alt` means the `alt`
 * attribute. In HEEx `:for` does NOT mean the `for` attribute — it is a comprehension. The five
 * special-attribute names are a closed set fixed by the grammar, and none of them bare-names to any
 * attribute any check reads (`alt`, `lang`, `xml:lang`, `tabindex`, `href`, `role`, and the rule's
 * `name_attributes` / `presentation_attributes`), so nothing today can be misled by it. It is written
 * down so that a check which starts reading `for` finds this note rather than the behaviour.
 *
 * ENTITIES ARE DROPPED, WHICH IS `langs/html.ts`'s BEHAVIOUR AND NOT AN INDEPENDENT CHOICE. Both
 * grammars give `&times;` a node of its own, and `langs/html.ts` converts only `text`. A control whose
 * only content is an entity therefore reads as unnamed in both languages, which reports MORE rather
 * than fewer — the direction this whole module errs in — and, more to the point, reports the SAME in
 * both, which is the property that lets one check be written once for every adapter.
 */

import { attr, el, expr, text, type IrAttr, type IrNode } from "../ir.js";
import { maskDoctypeDeclarations, maskOutside } from "../masked.js";
import { endLine1, kids, line1, parseWith, type ParseSession, type TsNode } from "../ts.js";

/** The three element shapes, each with the open node the attributes and the name live on. */
const OPEN_OF: Record<string, string[]> = {
  tag: ["start_tag", "self_closing_tag"],
  component: ["start_component", "self_closing_component"],
  slot: ["start_slot", "self_closing_slot"],
};

const OPEN_TYPES = new Set(Object.values(OPEN_OF).flat());
const CLOSE_TYPES = new Set(["end_tag", "end_component", "end_slot"]);
const NAME_TYPES = ["tag_name", "component_name", "slot_name"];

/** `<:col …>` is written with its colon, so the IR carries it: a slot is not an element named `col`. */
function nameOf(open: TsNode): string | null {
  for (const c of kids(open)) {
    if (c.type === "slot_name") return `:${c.text}`;
    if (NAME_TYPES.includes(c.type)) return c.text;
  }
  return null;
}

/** The literal text of an attribute value, or null when the adapter can see the attribute only. */
function valueOf(node: TsNode): { value: string | null; dynamic: boolean } {
  for (const c of kids(node)) {
    if (c.type === "quoted_attribute_value") {
      return { value: kids(c).find((x) => x.type === "attribute_value")?.text ?? "", dynamic: false };
    }
    if (c.type === "attribute_value") return { value: c.text, dynamic: false };
    // `class={@class}`: a value computed at render time, whose content is unknowable.
    if (c.type === "expression") return { value: null, dynamic: true };
  }
  return { value: null, dynamic: false };
}

function readAttrs(open: TsNode): { attrs: IrAttr[]; opaque: boolean } {
  const attrs: IrAttr[] = [];
  let opaque = false;
  for (const c of kids(open)) {
    if (c.type === "attribute") {
      const name = kids(c).find((x) => x.type === "attribute_name")?.text;
      if (name === undefined) continue;
      const { value, dynamic } = valueOf(c);
      attrs.push(attr(name, value, dynamic));
    } else if (c.type === "special_attribute") {
      const name = kids(c).find((x) => x.type === "special_attribute_name")?.text;
      if (name !== undefined) attrs.push(attr(name, null, true));
    } else if (c.type === "expression") {
      // `<div {@rest}>` — an attribute bag this adapter cannot read, exactly as a JSX spread is.
      opaque = true;
    }
  }
  return { attrs, opaque };
}

/** `<%= … %>` renders text; `<% … %>`, `<%%= … %>` and `<%# … %>` do not. */
const rendersText = (directive: TsNode): boolean => /^<%=/.test(directive.text);

function convert(node: TsNode, ignore: TsNode | null = null): IrNode[] {
  const out: IrNode[] = [];
  for (const c of kids(node)) {
    if (ignore !== null && c.id === ignore.id) continue;
    const openTypes = OPEN_OF[c.type];
    if (openTypes !== undefined) {
      const open = kids(c).find((x) => openTypes.includes(x.type));
      if (!open) {
        out.push(...convert(c));
        continue;
      }
      const { attrs, opaque } = readAttrs(open);
      const children = convert(c, open);
      out.push(el(nameOf(open), line1(open), { endLine: endLine1(open), attrs, opaqueAttrs: opaque, children }));
    } else if (OPEN_TYPES.has(c.type)) {
      // An opening construct with no element around it: the file is broken and tree-sitter recovered
      // by leaving it loose. Read it as an element with no children rather than dropping it — the
      // same recovery `langs/html.ts` performs, for the same reason.
      const { attrs, opaque } = readAttrs(c);
      out.push(el(nameOf(c), line1(c), { endLine: endLine1(c), attrs, opaqueAttrs: opaque, children: [] }));
    } else if (CLOSE_TYPES.has(c.type)) {
      // A closing tag carries nothing the document renders.
    } else if (c.type === "text") {
      out.push(text(c.text, line1(c)));
    } else if (c.type === "expression") {
      out.push(expr(line1(c)));
    } else if (c.type === "directive") {
      if (rendersText(c)) out.push(expr(line1(c)));
    } else if (c.type === "comment" || c.type === "doctype" || c.type === "entity") {
      // Comments are not markup; entities follow `langs/html.ts`, which converts only `text`.
    } else if (c.isNamed) {
      out.push(...convert(c));
    }
  }
  return out;
}

/**
 * A `.heex` template, read as the document it is.
 *
 * ONE CONSTRUCT IS BLANKED BEFORE THE PARSE AND IT IS NOT MARKUP: a `<!DOCTYPE …>` declaration. The
 * grammar accepts only the HTML5 spelling and an XHTML one takes the whole file into error recovery;
 * `masked.ts` holds the mask and the measurement behind it.
 *
 * TWO LIMITS OF `tree-sitter-heex@0.9.0` ARE RECORDED RATHER THAN WORKED AROUND, because both were
 * measured over the corpus and neither costs a document:
 *
 *   - A VOID ELEMENT WRITTEN WITHOUT ITS SLASH (`<br>`, `<img src="x">`) has no rule in the grammar:
 *     `tag` is `start_tag … end_tag` or `self_closing_tag`, so the void element adopts its parent's
 *     closing tag and the parent's opening tag is left loose. The elements THEMSELVES all survive —
 *     the loose opener is read as a childless element and the void one keeps its own attributes and
 *     its own start and end lines — so checks (A) to (E), which turn on one element's attributes,
 *     are unaffected; what is lost is containment, which only check (F) reads. Corpus-wide there is
 *     ONE such tag: 0 in 120 `.heex` files, 1 in the 94 `.ex` files carrying a `~H` sigil, because
 *     `mix format` self-closes void tags in HEEx. The repair is a rewrite that inserts the slash,
 *     which is the first length-changing transform this module would have, and it is not worth that
 *     for one tag; it is written down so the next reader prices it against evidence rather than
 *     rediscovering it.
 *   - THERE IS NO `script_element`, so a `<` inside a `<script>` body is read as the start of a tag.
 *     That direction over-reports rather than falling silent, which is the direction `masked.ts`
 *     chooses throughout.
 */
export function parseHeex(source: string, session: ParseSession): IrNode[] {
  return convert(parseWith("heex", maskDoctypeDeclarations(source), session));
}

/**
 * The body range of every `~H` sigil in a parsed Elixir file, in document order and disjoint.
 *
 * THE GRAMMAR SPELLS A SIGIL AS `sigil` → `~`, `sigil_name`, an opening delimiter, `quoted_content`,
 * a closing delimiter, and it spells every delimiter the language has the same way: the heredoc
 * fences `"""` and `'''`, the paired `(`/`[`/`{`/`<`, and the self-closing `"`/`'`/`|`/`/` all
 * produce the same three named children. So ONE test — `sigil_name` is exactly `H` — replaces the
 * whole delimiter table the lexical scanner needs, and the delimiter cases stop being cases.
 *
 * WHAT THE PARSE KNOWS THAT A SCANNER CANNOT. A `~H` written inside a string literal or inside a
 * `#` comment is not a sigil, and the tree says so: it is `quoted_content` of a `string` node, or the
 * text of a `comment` node, and neither is a `sigil`. Reading such a region as a template puts
 * Elixir source into the HEEx parser as text — over-reporting rather than silence, which is the
 * direction this module errs in, but it is still wrong about what the file contains.
 *
 * THE WALK DOES NOT DESCEND INTO A `~H` BODY, because a sigil body is not Elixir and nothing inside
 * it is another Elixir sigil. It DOES descend into every other sigil, so a `~H` reached through an
 * `#{…}` interpolation inside some other sigil is still found. Ranges are sorted by start for the
 * caller, which needs them ordered, rather than relying on the traversal to guarantee it.
 *
 * A BROKEN FILE LEAVES THE SIGIL'S PARTS LOOSE, AND THEY ARE READ ANYWAY. An unterminated `~H"""`
 * heredoc is not valid Elixir, so there is no `sigil` node at all: the parse recovers by putting an
 * `ERROR` node around the whole construct and leaving `~`, `sigil_name` and `quoted_content` as loose
 * siblings inside it. Dropping that would make a file with one unclosed template read as nothing —
 * the silence this module is written against — so the loose shape is recognised as well, on exactly
 * the same terms `convert` below already recognises a loose `start_tag`: the file is broken, the
 * parse recovered, and what it recovered is read rather than thrown away. The pattern is exact —
 * `sigil_name` `H`, then anonymous delimiter tokens only, then `quoted_content` — so it cannot pair a
 * sigil name with some later unrelated string in the same `ERROR` node. It can only fire on a file
 * that already failed to parse, and there it reads MORE than the lexical scanner did rather than
 * less: the scanner masked an unterminated body, and the parse hands back the body it recovered.
 */
function heexSigilBodies(root: TsNode): { start: number; end: number }[] {
  const bodies: { start: number; end: number }[] = [];
  const take = (body: TsNode | undefined): void => {
    // An empty sigil (`~H""`) has no `quoted_content` child and contributes no region.
    if (body) bodies.push({ start: body.startIndex, end: body.endIndex });
  };
  const visit = (n: TsNode): void => {
    const cs = kids(n);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.type === "sigil") {
        if (kids(c).find((x) => x.type === "sigil_name")?.text === "H") {
          take(kids(c).find((x) => x.type === "quoted_content"));
        } else {
          visit(c);
        }
        continue;
      }
      if (c.type === "sigil_name" && c.text === "H") {
        // The recovery shape: skip the anonymous delimiter tokens, and take what follows only if it
        // is the content itself.
        let j = i + 1;
        while (j < cs.length && !cs[j].isNamed) j++;
        if (j < cs.length && cs[j].type === "quoted_content") {
          take(cs[j]);
          i = j;
          continue;
        }
      }
      visit(c);
    }
  };
  visit(root);
  return bodies.sort((a, b) => a.start - b.start);
}

/**
 * An Elixir source file, read for the HEEx templates written inside it.
 *
 * TWO GRAMMARS, AND THE SECOND ONE IS NEW AS OF 2026-08-28. The Elixir grammar locates the `~H` sigil
 * bodies and the HEEx grammar reads what is inside them. Until Apache-2.0 was permitted for
 * vendored grammars on that date the first grammar could not be shipped, and the boundaries were
 * found by reading the text (`masked.ts`, `maskOutsideHeexSigils`). That function is still there,
 * whole and exported, as the documented fallback if the grammar is ever withdrawn; what it is NOT is
 * a silent substitute when the grammar fails to load, and its header says why.
 *
 * THIS ADAPTER EXTRACTS REGIONS AND MASKS; IT BUILDS NO STATEMENT-LEVEL IR. The IR is a markup IR —
 * `IrElement | IrText | IrExpr` — and has no node for a call, an argument or an assignment, so there
 * is nothing for an Elixir function or module to become (engine-capabilities 2026-08-27, Q2). What a
 * `.ex` file contributes is its `~H` templates, and everything else in it is blanked. That is why
 * the Elixir tree is used for its ranges and then dropped: the grammar is here to say WHERE the
 * markup is, not to be converted.
 *
 * A FILE WITH NO SIGIL READS AS AN EMPTY DOCUMENT, AND THAT IS AN ANSWER, NOT A FAILURE. The outcome
 * is still `parsed`: "this file has no markup in it" and "this file cannot be read" are different
 * answers and `parse.ts` counts them apart. Before this adapter existed every `.ex` file was the
 * second one.
 *
 * THE TWO CHARACTERS `~H` ARE TESTED FOR BEFORE ANY PARSE, AND THAT IS NOT A LEXICAL READING OF THE
 * FILE. It is a necessary condition: an Elixir `~H` sigil cannot exist in a file whose text does not
 * contain `~H`, whatever the parse would say, so a file without those two characters can be answered
 * without one. It can never hide a sigil, which is the property that separates it from the scanner in
 * `masked.ts`; what it buys is the 700-odd `.ex` files in a Phoenix application that carry no
 * template at all, and the megabyte-scale Elixir grammar not being asked about any of them.
 *
 * ONE CONSEQUENCE OF THAT SHORT-CIRCUIT, STATED SO IT IS NOT A SURPRISE. When a grammar cannot be
 * loaded, a `.ex` file containing `~H` raises `GrammarUnavailableError` and is counted, as `parse.ts`
 * requires; a `.ex` file containing none is still reported as `parsed`, because no grammar was needed
 * to establish that it holds no markup and nothing was lost by not loading one. The
 * grammar-unavailable count for `elixir` is therefore the number of files that HAD something to read,
 * which is the size of the hole rather than the size of the language.
 */
export function parseElixir(source: string, session: ParseSession): IrNode[] {
  if (!source.includes("~H")) return [];
  const bodies = heexSigilBodies(parseWith("elixir", source, session));
  if (bodies.length === 0) return [];
  return parseHeex(maskOutside(source, bodies), session);
}
