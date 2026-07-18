"use client";

import { useEffect, useRef } from "react";
import type EditorJS from "@editorjs/editorjs";
import type { API, EditorConfig, OutputData } from "@editorjs/editorjs";
import type { EditorBlock, EditorDoc } from "@/lib/blocks";

export interface StudioEditorApi {
  /** The block the caret is in, or null if none is focused. */
  getCurrentBlock: () => Promise<EditorBlock | null>;
  /** Replace a block's data in place, then push the fresh doc to onChange. */
  updateBlock: (id: string, data: Record<string, unknown>) => Promise<void>;
}

interface Props {
  /** Seeds the editor on mount only; later prop changes are ignored so the
   *  editor stays the source of truth while the user types. */
  initial: EditorDoc;
  onChange: (doc: EditorDoc) => void;
  /** Populated with an imperative handle once the editor is ready. */
  apiRef?: { current: StudioEditorApi | null };
}

/**
 * Thin Editor.js wrapper. Editor.js touches `window`/`document`, so it is
 * loaded lazily inside the effect (browser only) rather than imported at module
 * scope. Guards handle React's development double-mount and the async init race.
 */
export default function BlockEditor({ initial, onChange, apiRef }: Props) {
  const holderRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorJS | null>(null);
  const onChangeRef = useRef(onChange);
  const initialRef = useRef(initial);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let destroyed = false;

    void (async () => {
      const [{ default: EditorJSCtor }, { default: Header }, { default: List }, { default: Table }, { default: Quote }] =
        await Promise.all([
          import("@editorjs/editorjs"),
          import("@editorjs/header"),
          import("@editorjs/list"),
          import("@editorjs/table"),
          import("@editorjs/quote"),
        ]);
      if (destroyed || !holderRef.current) return;

      const editor = new EditorJSCtor({
        holder: holderRef.current,
        autofocus: false,
        placeholder: "Write here — or press Tab to add a heading, list, or table…",
        data: initialRef.current as unknown as OutputData,
        tools: {
          header: { class: Header, inlineToolbar: true, config: { levels: [1, 2, 3], defaultLevel: 2 } },
          list: { class: List, inlineToolbar: true },
          table: { class: Table, inlineToolbar: true },
          quote: { class: Quote, inlineToolbar: true },
        } as unknown as EditorConfig["tools"],
        onChange: async (api: API) => {
          try {
            const data = await api.saver.save();
            onChangeRef.current(data as unknown as EditorDoc);
          } catch {
            /* transient save errors while typing are safe to ignore */
          }
        },
      });

      if (destroyed) {
        editor.isReady.then(() => editor.destroy()).catch(() => {});
        return;
      }
      editorRef.current = editor;

      if (apiRef) {
        apiRef.current = {
          async getCurrentBlock() {
            const index = editor.blocks.getCurrentBlockIndex();
            if (index < 0) return null;
            const data = await editor.save();
            const block = data.blocks[index];
            return block
              ? { id: block.id, type: block.type, data: (block.data ?? {}) as Record<string, unknown> }
              : null;
          },
          async updateBlock(id, newData) {
            await editor.blocks.update(id, newData);
            const doc = await editor.save();
            onChangeRef.current(doc as unknown as EditorDoc);
          },
        };
      }
    })();

    return () => {
      destroyed = true;
      const inst = editorRef.current;
      editorRef.current = null;
      if (apiRef) apiRef.current = null;
      if (inst) inst.isReady.then(() => inst.destroy()).catch(() => {});
    };
    // Mount once — `initial` is captured via ref on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={holderRef} className="min-h-[55vh] px-2" />;
}
