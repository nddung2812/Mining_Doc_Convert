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

/** Inline formatting (bold/italic/links) arrives as sanitized Editor.js HTML —
 *  rendered as-is, matching how the existing template previews handle content. */
function inline(value: unknown): string {
  return typeof value === "string" ? value : "";
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
