import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  inspectFile,
  isAllowedMime,
  isImageMime,
  isVideoMime,
  MAX_FILE_BYTES,
  sanitizeFileName,
} from '../../src/lib/files';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const MP4 = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

function makeFile(bytes: Uint8Array<ArrayBuffer>, name: string, type: string): File {
  return new File([bytes], name, { type });
}

describe('file inspection & Free Tier limits', () => {
  it('enforces a strict 256 KB raw attachment cap', () => {
    expect(MAX_FILE_BYTES).toBe(256 * 1024);
  });

  it('accepts valid PNG and MP4 signatures under 256 KB', async () => {
    const pngResult = await inspectFile(makeFile(PNG, 'photo.png', 'image/png'));
    expect(pngResult).toEqual({ ok: true, mime: 'image/png', kind: 'image', name: 'photo.png' });

    const mp4Result = await inspectFile(makeFile(MP4, 'clip.mp4', 'video/mp4'));
    expect(mp4Result).toEqual({ ok: true, mime: 'video/mp4', kind: 'video', name: 'clip.mp4' });
  });

  it('rejects mismatched contents and extensions', async () => {
    await expect(inspectFile(makeFile(PNG, 'photo.txt', 'text/plain'))).resolves.toMatchObject({
      ok: false,
    });
    await expect(inspectFile(makeFile(PNG, 'photo.png', 'application/pdf'))).resolves.toMatchObject(
      { ok: false },
    );
    await expect(inspectFile(makeFile(PNG, 'photo.exe', 'image/png'))).resolves.toMatchObject({
      ok: false,
    });
  });

  it('rejects empty, oversized (>256 KB), and malformed files', async () => {
    await expect(
      inspectFile(makeFile(new Uint8Array(), 'empty.txt', 'text/plain')),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      inspectFile(makeFile(new Uint8Array(MAX_FILE_BYTES + 1), 'big.png', 'image/png')),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      inspectFile(makeFile(new Uint8Array([0xff, 0xfe, 0xfd]), 'bad.txt', 'text/plain')),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      inspectFile(makeFile(new TextEncoder().encode('hello\0world'), 'binary.txt', 'text/plain')),
    ).resolves.toMatchObject({ ok: false });
  });

  it('accepts valid UTF-8 text and derives MIME from the extension', async () => {
    const file = makeFile(new TextEncoder().encode('# Notes\n'), 'notes.md', '');
    const result = await inspectFile(file);
    expect(result).toMatchObject({ ok: true, mime: 'text/plain', kind: 'text' });
  });

  it('sanitizes names and reports sizes', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('.env')).toBe('env');
    expect(sanitizeFileName('..hidden.txt')).toBe('hidden.txt');
    expect(sanitizeFileName('a\u0000b\u001fc.txt')).toBe('abc.txt');
    expect(sanitizeFileName(' report (final).pdf ')).toBe('report (final).pdf');
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('x'.repeat(200)).length).toBe(96);

    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('exposes MIME helpers', () => {
    expect(isAllowedMime('image/png')).toBe(true);
    expect(isAllowedMime('video/mp4')).toBe(true);
    expect(isAllowedMime('image/svg+xml')).toBe(false);
    expect(isImageMime('image/webp')).toBe(true);
    expect(isVideoMime('video/webm')).toBe(true);
    expect(isImageMime('application/pdf')).toBe(false);
  });
});
