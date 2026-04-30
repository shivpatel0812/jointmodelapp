import { useCallback, useRef, useState } from "react";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  type LocalAttachment,
  validateAndReadFile,
} from "../promptAttachments";

type Props = {
  attachments: LocalAttachment[];
  onChange: (next: LocalAttachment[]) => void;
  /** Surface validation errors (also shown inline). */
  onError?: (msg: string | null) => void;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function PromptAttachments({ attachments, onChange, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const arr = Array.from(fileList);
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

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      void addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  return (
    <div className="mt-4">
      <p className="mb-2 text-sm font-medium text-zinc-300">Attachments</p>
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className={`rounded-xl border border-dashed px-4 py-4 transition ${
          dragOver
            ? "border-blue-500/70 bg-blue-500/5"
            : "border-zinc-700 bg-zinc-950/40"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={["image/png", "image/jpeg", "image/webp"].join(",")}
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files?.length) void addFiles(files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={attachments.length >= MAX_ATTACHMENT_COUNT}
            className="rounded-full border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Add image
          </button>
          <span className="text-xs text-zinc-500">
            PNG / JPEG / WebP · max {MAX_ATTACHMENT_COUNT} ·{" "}
            {Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB each · drag & drop
          </span>
        </div>
        {attachments.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/80 px-2 py-1.5 text-sm text-zinc-200"
              >
                <span className="max-w-[140px] truncate font-medium" title={a.fileName}>
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
  );
}
