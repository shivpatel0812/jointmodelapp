import { type ReactNode, useCallback, useRef, useState } from "react";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  type LocalAttachment,
  validateAndReadFile,
} from "../promptAttachments";

type Props = {
  /** Prompt label + textarea — entire block is the image drop target. */
  children: ReactNode;
  attachments: LocalAttachment[];
  onChange: (next: LocalAttachment[]) => void;
  onError?: (msg: string | null) => void;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function PromptAttachments({ children, attachments, onChange, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const arr = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
      if (arr.length === 0 && Array.from(fileList).length > 0) {
        onError?.("Only image files can be attached here.");
        return;
      }
      if (arr.length === 0) return;
      onError?.(null);
      let next = [...attachments];
      try {
        for (const file of arr) {
          if (next.length >= MAX_ATTACHMENT_COUNT) {
            throw new Error(`Maximum ${MAX_ATTACHMENT_COUNT} images per prompt.`);
          }
          const att = await validateAndReadFile(file);
          next.push(att);
        }
        onChange(next);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        onError?.(msg);
      }
    },
    [attachments, onChange, onError],
  );

  const remove = useCallback(
    (id: string) => {
      onChange(attachments.filter((a) => a.id !== id));
      onError?.(null);
    },
    [attachments, onChange, onError],
  );

  const endDrag = useCallback(() => {
    dragDepth.current = 0;
    setDragOver(false);
  }, []);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragOver(false);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      endDrag();
      void addFiles(e.dataTransfer.files);
    },
    [addFiles, endDrag],
  );

  const browseDisabled = attachments.length >= MAX_ATTACHMENT_COUNT;

  return (
    <div className="relative">
      <div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={`relative rounded-xl border transition ${
          dragOver
            ? "border-blue-500/80 bg-blue-500/[0.07] ring-2 ring-blue-500/35"
            : "border-zinc-700/90 bg-zinc-950/30"
        }`}
      >
        {dragOver ? (
          <div
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-zinc-950/75 backdrop-blur-[2px]"
            aria-hidden
          >
            <p className="rounded-lg border border-blue-500/50 bg-blue-950/80 px-4 py-3 text-sm font-medium text-blue-100 shadow-lg">
              Drop images here to attach
            </p>
          </div>
        ) : null}

        <div className="relative z-10 space-y-3 p-3 sm:p-4">
          {children}

          <div className="flex flex-col gap-2 border-t border-zinc-800/80 pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-xs text-zinc-500">
                Drag & drop images onto this prompt box · PNG / JPEG / WebP · max{" "}
                {MAX_ATTACHMENT_COUNT} · {Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB each
              </p>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={browseDisabled}
                className="text-xs font-medium text-blue-400/95 underline decoration-blue-500/40 underline-offset-2 hover:text-blue-300 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40"
              >
                Browse files
              </button>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={["image/png", "image/jpeg", "image/webp"].join(",")}
              multiple
              className="sr-only"
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) void addFiles(files);
                e.target.value = "";
              }}
            />
            {attachments.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/80 px-2 py-1.5 text-sm text-zinc-200"
                  >
                    <span className="max-w-[160px] truncate font-medium" title={a.fileName}>
                      {a.fileName}
                    </span>
                    <span className="text-xs text-zinc-500">{formatBytes(a.sizeBytes)}</span>
                    <button
                      type="button"
                      onClick={() => remove(a.id)}
                      className="rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      aria-label={`Remove ${a.fileName}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
