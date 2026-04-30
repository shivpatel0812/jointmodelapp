/** Client-side validation + encoding for multimodal prompts (images stay in-flight only). */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_COUNT = 5;
export const ALLOWED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;

export type LocalAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Raw base64 without data URL prefix — sent to API */
  base64: string;
};

export type ImagePayload = {
  file_name: string;
  mime_type: string;
  base64: string;
};

export function toImagePayloads(files: LocalAttachment[]): ImagePayload[] {
  return files.map((f) => ({
    file_name: f.fileName,
    mime_type: f.mimeType,
    base64: f.base64,
  }));
}

export function attachmentSummaryMeta(
  files: LocalAttachment[],
): { fileName: string; mimeType: string; sizeBytes: number }[] {
  return files.map((f) => ({
    fileName: f.fileName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
  }));
}

export function validateAndReadFile(file: File): Promise<LocalAttachment> {
  const mime = file.type.toLowerCase();
  if (!ALLOWED_IMAGE_MIMES.includes(mime as (typeof ALLOWED_IMAGE_MIMES)[number])) {
    return Promise.reject(
      new Error(`Unsupported type "${mime}". Use PNG, JPEG, or WebP.`),
    );
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return Promise.reject(
      new Error(
        `"${file.name}" is too large (max ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB).`,
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== "string") {
        reject(new Error("Could not read image."));
        return;
      }
      const comma = r.indexOf(",");
      const b64 = comma >= 0 ? r.slice(comma + 1) : r;
      if (!b64) {
        reject(new Error("Empty image data."));
        return;
      }
      resolve({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        fileName: file.name,
        mimeType: mime,
        sizeBytes: file.size,
        base64: b64,
      });
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}
