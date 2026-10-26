/**
 * Strict attachment limits designed to protect Supabase Free Tier storage.
 * Raw files (PDF, TXT, short video clips) are capped at 256 KB.
 * Smartphone camera photos up to 8 MB are automatically resized & compressed
 * client-side to <= 190 KB before end-to-end encryption.
 */
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
const TARGET_COMPRESSED_IMAGE_BYTES = 185 * 1024;
const MAX_IMAGE_DIMENSION = 1280;

export const ACCEPTED_FILE_TYPES =
  '.jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.pdf,.txt,.md,.csv,.log,image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,application/pdf,text/plain';

export type FileKind = 'image' | 'video' | 'pdf' | 'text';

type AllowedType = {
  kind: FileKind;
  extensions: string[];
};

const ALLOWED_TYPES: Record<string, AllowedType> = {
  'image/jpeg': { kind: 'image', extensions: ['jpg', 'jpeg'] },
  'image/png': { kind: 'image', extensions: ['png'] },
  'image/webp': { kind: 'image', extensions: ['webp'] },
  'image/gif': { kind: 'image', extensions: ['gif'] },
  'video/mp4': { kind: 'video', extensions: ['mp4'] },
  'video/webm': { kind: 'video', extensions: ['webm'] },
  'application/pdf': { kind: 'pdf', extensions: ['pdf'] },
  'text/plain': { kind: 'text', extensions: ['txt', 'md', 'csv', 'log'] },
};

const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/plain',
  csv: 'text/plain',
  log: 'text/plain',
};

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (bytes.length < start + length) return '';
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function hasMagicBytes(bytes: Uint8Array, mime: string): boolean {
  switch (mime) {
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/gif':
      return ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a';
    case 'image/webp':
      return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
    case 'video/mp4':
      return ascii(bytes, 4, 4) === 'ftyp';
    case 'video/webm':
      return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    case 'application/pdf':
      return ascii(bytes, 0, 5) === '%PDF-';
    case 'text/plain':
      return bytes.length > 0 && !bytes.includes(0);
    default:
      return false;
  }
}

export type FileInspection =
  { ok: true; mime: string; kind: FileKind; name: string } | { ok: false; error: string };

export async function inspectFile(file: File): Promise<FileInspection> {
  if (!file.size) return { ok: false, error: 'That file is empty.' };
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `Files and clips are limited to ${formatBytes(MAX_FILE_BYTES)} to keep cloud storage fast and light.`,
    };
  }

  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = file.type || EXTENSION_TO_MIME[extension] || '';
  const allowed = ALLOWED_TYPES[mime];

  if (!allowed || !allowed.extensions.includes(extension)) {
    return {
      ok: false,
      error: 'Supported formats: JPG, PNG, WebP, GIF, MP4, WebM, PDF, TXT, MD, CSV, and LOG.',
    };
  }

  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (!hasMagicBytes(bytes, mime)) {
    return { ok: false, error: 'The file contents do not match its extension.' };
  }

  if (mime === 'text/plain') {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      return { ok: false, error: 'Text files must be valid UTF-8.' };
    }
  }

  return { ok: true, mime, kind: allowed.kind, name: sanitizeFileName(file.name) };
}

async function compressRasterImage(file: File, baseName: string): Promise<File | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return null;
  }
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height, 1));
      let width = Math.max(1, Math.round(bitmap.width * scale));
      let height = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement('canvas');
      const qualities = [0.82, 0.68, 0.54, 0.42];
      const stem = baseName.replace(/\.[^.]+$/, '') || 'photo';

      for (let pass = 0; pass < 2; pass += 1) {
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(bitmap, 0, 0, width, height);

        for (const quality of qualities) {
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, 'image/jpeg', quality),
          );
          if (blob && blob.size > 0 && blob.size <= TARGET_COMPRESSED_IMAGE_BYTES) {
            return new File([blob], `${stem}.jpg`, { type: 'image/jpeg' });
          }
          if (
            blob &&
            pass === 1 &&
            quality === qualities[qualities.length - 1] &&
            blob.size <= MAX_FILE_BYTES
          ) {
            return new File([blob], `${stem}.jpg`, { type: 'image/jpeg' });
          }
        }
        width = Math.max(1, Math.round(width * 0.72));
        height = Math.max(1, Math.round(height * 0.72));
      }
      return null;
    } finally {
      bitmap.close?.();
    }
  } catch {
    return null;
  }
}

/**
 * Validates any selected file and automatically optimizes camera photos on smartphones
 * (stripping EXIF metadata and fitting strictly under 256 KB).
 */
export async function prepareAttachmentFile(
  file: File,
): Promise<
  | { ok: true; file: File; mime: string; kind: FileKind; name: string; compressed: boolean }
  | { ok: false; error: string }
> {
  if (!file.size) return { ok: false, error: 'That file is empty.' };

  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = file.type || EXTENSION_TO_MIME[extension] || '';
  const isCompressibleImage =
    mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';

  if (isCompressibleImage) {
    if (file.size > MAX_SOURCE_IMAGE_BYTES) {
      return {
        ok: false,
        error: 'Photos larger than 8 MB cannot be compressed. Choose a smaller photo.',
      };
    }
    const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
    if (!hasMagicBytes(header, mime)) {
      return { ok: false, error: 'The image contents do not match its file type.' };
    }
    const cleanName = sanitizeFileName(file.name);
    if (file.size > TARGET_COMPRESSED_IMAGE_BYTES) {
      const compressed = await compressRasterImage(file, cleanName);
      if (compressed) {
        const checked = await inspectFile(compressed);
        if (checked.ok) {
          return { ...checked, file: compressed, compressed: true };
        }
      }
    }
  }

  const checked = await inspectFile(file);
  if (!checked.ok) return checked;
  return { ...checked, file, compressed: false };
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .replace(/[\p{Cc}]/gu, '')
    .replace(/[^\w.\- ()]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'file').slice(0, 96);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileKind(mime: string): FileKind {
  return ALLOWED_TYPES[mime]?.kind ?? 'text';
}

export function isImageMime(mime: string): boolean {
  return ALLOWED_TYPES[mime]?.kind === 'image';
}

export function isVideoMime(mime: string): boolean {
  return ALLOWED_TYPES[mime]?.kind === 'video';
}

export function isAllowedMime(mime: string): boolean {
  return Boolean(ALLOWED_TYPES[mime]);
}
