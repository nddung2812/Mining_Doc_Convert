import mammoth from "mammoth";

const MAX_SOURCE_CHARS = 400_000;

/** Extract plain text from an uploaded source file (.txt, .md, .docx, .pdf). */
export async function extractSourceText(filename: string, buffer: Buffer): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  let text: string;

  if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (ext === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = result.text;
  } else if (ext === "txt" || ext === "md" || ext === "markdown") {
    text = buffer.toString("utf8");
  } else {
    throw new Error(`Unsupported source file type ".${ext}". Upload .docx, .pdf, .txt, or .md.`);
  }

  text = text.trim();
  if (!text) throw new Error("The source file contains no extractable text.");
  if (text.length > MAX_SOURCE_CHARS) {
    throw new Error(
      `Source is too large (${text.length.toLocaleString()} chars, limit ${MAX_SOURCE_CHARS.toLocaleString()}). Split it and run separately.`,
    );
  }
  return text;
}
