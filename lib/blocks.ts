/**
 * The block-document model behind the Content Studio. It is Editor.js
 * `OutputData` verbatim, so a saved document round-trips into the editor with no
 * translation on the way out.
 *
 * Keep this module free of `fs`/server-only imports — it is imported by the
 * client-side live preview as well as the server. Seeding (which reads the
 * fixed section catalog) lives in the studio route handler, not here.
 */

export interface ListItem {
  content: string;
  items?: ListItem[];
  meta?: Record<string, unknown>;
}

export interface EditorBlock {
  id?: string;
  type: string;
  data: Record<string, unknown>;
}

export interface EditorDoc {
  time?: number;
  blocks: EditorBlock[];
  version?: string;
}

const ACCENT = "#1F3A5F";
const TABLE_BORDER = "#9FB3CC";
const TABLE_HEADER_FILL = "#E8EDF4";

const HEADING_SIZE: Record<number, number> = { 1: 27, 2: 20, 3: 16, 4: 14, 5: 13, 6: 12 };

/** Tags allowed through the sanitizer verbatim (attributes always dropped). */
const ALLOWED_INLINE_TAGS = new Set(["b", "strong", "i", "em", "u", "code", "mark"]);

/** Matches one HTML tag, tolerating `>` inside quoted attribute values. */
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;

/**
 * Allowlist sanitizer for the inline HTML stored in block text. Block content
 * the user typed is sanitized by Editor.js, but AI-revised blocks carry model
 * output — which reads client-supplied documents — so nothing reaches
 * `dangerouslySetInnerHTML` unsanitized. Only simple formatting tags survive,
 * with every attribute stripped; `<a>` keeps an http(s) href only. Disallowed
 * tags are dropped (their text content still renders); stray `<` is escaped.
 */
export function sanitizeInline(html: string): string {
  let out = "";
  let last = 0;
  let suppressed = 0; // inside <script>/<style>: drop the content, not just the tags
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html)) !== null) {
    if (suppressed === 0) out += html.slice(last, m.index).replace(/</g, "&lt;");
    const tag = m[1].toLowerCase();
    const closing = m[0].startsWith("</");
    if (tag === "script" || tag === "style") {
      suppressed = Math.max(0, suppressed + (closing ? -1 : 1));
      last = TAG_RE.lastIndex;
      continue;
    }
    if (suppressed > 0) {
      last = TAG_RE.lastIndex;
      continue;
    }
    if (tag === "br") {
      if (!closing) out += "<br>";
    } else if (ALLOWED_INLINE_TAGS.has(tag)) {
      out += closing ? `</${tag}>` : `<${tag}>`;
    } else if (tag === "a") {
      if (closing) {
        out += "</a>";
      } else {
        const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[2]);
        const url = href?.[1] ?? href?.[2] ?? href?.[3] ?? "";
        out += /^https?:\/\//i.test(url)
          ? `<a href="${url.replace(/"/g, "&quot;")}" rel="noopener noreferrer">`
          : "<a>";
      }
    }
    last = TAG_RE.lastIndex;
  }
  if (suppressed === 0) out += html.slice(last).replace(/</g, "&lt;");
  return out;
}

/** Inline formatting (bold/italic/links) stored as Editor.js HTML — sanitized
 *  to an allowlist before it reaches the preview's dangerouslySetInnerHTML. */
function inline(value: unknown): string {
  return typeof value === "string" ? sanitizeInline(value) : "";
}

function renderList(items: ListItem[], ordered: boolean): string {
  const tag = ordered ? "ol" : "ul";
  const lis = items
    .map((item) => {
      const nested = item.items && item.items.length ? renderList(item.items, ordered) : "";
      return `<li style="margin:3px 0;">${inline(item.content)}${nested}</li>`;
    })
    .join("");
  return `<${tag} style="margin:8px 0;padding-left:22px;line-height:1.55;">${lis}</${tag}>`;
}

/** Render a block document to a self-contained, branded HTML string for the
 *  live preview. Deterministic and DOM-free so it is safe on server or client. */
export function blocksToHtml(doc: EditorDoc): string {
  const parts: string[] = [];
  for (const block of doc.blocks ?? []) {
    const d = block.data ?? {};
    switch (block.type) {
      case "header": {
        const level = Math.min(6, Math.max(1, Number(d.level) || 2));
        const size = HEADING_SIZE[level] ?? 16;
        const top = level <= 1 ? 0 : 20;
        parts.push(
          `<h${level} style="font-weight:700;color:${ACCENT};margin:${top}px 0 6px;font-size:${size}px;line-height:1.2;">${inline(d.text)}</h${level}>`,
        );
        break;
      }
      case "paragraph":
        parts.push(`<p style="margin:9px 0;line-height:1.65;">${inline(d.text)}</p>`);
        break;
      case "list":
        parts.push(
          renderList(Array.isArray(d.items) ? (d.items as ListItem[]) : [], String(d.style) === "ordered"),
        );
        break;
      case "quote":
        parts.push(
          `<blockquote style="margin:14px 0;padding:6px 16px;border-left:3px solid ${ACCENT};color:#475569;font-style:italic;">${inline(
            d.text,
          )}${d.caption ? `<footer style="font-style:normal;font-size:12px;color:#94a3b8;margin-top:4px;">— ${inline(d.caption)}</footer>` : ""}</blockquote>`,
        );
        break;
      case "table": {
        const rows = Array.isArray(d.content) ? (d.content as string[][]) : [];
        const withHeadings = d.withHeadings === true;
        const body = rows
          .map((row, i) => {
            const isHead = withHeadings && i === 0;
            const cellTag = isHead ? "th" : "td";
            const cellStyle = isHead
              ? `border:1px solid ${TABLE_BORDER};background:${TABLE_HEADER_FILL};color:${ACCENT};font-weight:700;padding:7px 10px;text-align:left;`
              : `border:1px solid ${TABLE_BORDER};padding:7px 10px;vertical-align:top;`;
            return `<tr>${row.map((c) => `<${cellTag} style="${cellStyle}">${inline(c)}</${cellTag}>`).join("")}</tr>`;
          })
          .join("");
        parts.push(
          `<table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:14px;">${body}</table>`,
        );
        break;
      }
      default:
        if (typeof d.text === "string") parts.push(`<p style="margin:9px 0;">${inline(d.text)}</p>`);
    }
  }
  return parts.join("\n");
}

const TEXT_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Strip inline tags and decode common entities: block HTML -> plain text. */
export function inlineToText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(TAG_RE, "")
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
      if (entity[0] === "#") {
        const code =
          entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return TEXT_ENTITIES[entity] ?? match;
    })
    .trim();
}

function listToText(items: ListItem[], ordered: boolean, depth: number): string[] {
  const lines: string[] = [];
  items.forEach((item, i) => {
    const marker = ordered ? `${i + 1}.` : "-";
    lines.push(`${"  ".repeat(depth)}${marker} ${inlineToText(item.content)}`);
    if (item.items && item.items.length) lines.push(...listToText(item.items, ordered, depth + 1));
  });
  return lines;
}

/**
 * Render a block document to markdown-ish plain text — the source format the
 * extraction engine consumes when a studio document is used as run input.
 */
export function blocksToText(doc: EditorDoc): string {
  const parts: string[] = [];
  for (const block of doc.blocks ?? []) {
    const d = block.data ?? {};
    switch (block.type) {
      case "header": {
        const level = Math.min(6, Math.max(1, Number(d.level) || 2));
        parts.push(`${"#".repeat(level)} ${inlineToText(d.text)}`);
        break;
      }
      case "paragraph":
        parts.push(inlineToText(d.text));
        break;
      case "list":
        parts.push(
          listToText(Array.isArray(d.items) ? (d.items as ListItem[]) : [], String(d.style) === "ordered", 0).join("\n"),
        );
        break;
      case "quote": {
        const caption = inlineToText(d.caption);
        parts.push(`> ${inlineToText(d.text)}${caption ? `\n> — ${caption}` : ""}`);
        break;
      }
      case "table": {
        const rows = Array.isArray(d.content) ? (d.content as string[][]) : [];
        parts.push(rows.map((row) => `| ${row.map((c) => inlineToText(c)).join(" | ")} |`).join("\n"));
        break;
      }
      default:
        if (typeof d.text === "string") parts.push(inlineToText(d.text));
    }
  }
  return parts.filter((p) => p.trim().length > 0).join("\n\n");
}
