export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export const ACCEPTED_FILE_TYPES =
  '.jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.md,.csv,.log,image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain';

type FileKind = 'image' | 'pdf' | 'text';

type AllowedType = {
  kind: FileKind;
  extensions: string[];
};

const ALLOWED_TYPES: Record<string, AllowedType> = {
  'image/jpeg': { kind: 'image', extensions: ['jpg', 'jpeg'] },
  'image/png': { kind: 'image', extensions: ['png'] },
  'image/webp': { kind: 'image', extensions: ['webp'] },
  'image/gif': { kind: 'image', extensions: ['gif'] },
  'application/pdf': { kind: 'pdf', extensions: ['pdf'] },
  'text/plain': { kind: 'text', extensions: ['txt', 'md', 'csv', 'log'] },
};

const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/plain',
  csv: 'text/plain',
  log: 'text/plain',
};

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function hasMagic(bytes: Uint8Array, mime: string): boolean {
  switch (mime) {
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/gif':
      return ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a';
    case 'image/webp':
      return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
    case 'application/pdf':
      return ascii(bytes, 0, 5) === '%PDF-';
    case 'text/plain':
      return !bytes.includes(0);
    default:
      return false;
  }
}

export type FileInspection =
  { ok: true; mime: string; kind: FileKind; name: string } | { ok: false; error: string };

export async function inspectFile(file: File): Promise<FileInspection> {
  if (!file.size) return { ok: false, error: 'That file is empty.' };
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: 'Files are limited to 2 MB because they travel peer-to-peer.' };
  }

  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = file.type || EXTENSION_TO_MIME[extension] || '';
  const allowed = ALLOWED_TYPES[mime];

  if (!allowed || !allowed.extensions.includes(extension)) {
    return {
      ok: false,
      error: 'Only JPG, PNG, WebP, GIF, PDF, TXT, MD, CSV, and LOG files are supported.',
    };
  }

  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (!hasMagic(bytes, mime)) {
    return { ok: false, error: 'The file contents do not match its type.' };
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

export function isAllowedMime(mime: string): boolean {
  return Boolean(ALLOWED_TYPES[mime]);
}
