export const DP_ACCEPT = 'image/*';
export const MAX_DP_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_DP_DATA_URL_LENGTH = 36_000;

const DP_DATA_URL_PATTERN = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'avif',
  'ico',
  'heic',
  'heif',
  'tif',
  'tiff',
  'jfif',
]);

export function isValidDpDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 32 &&
    value.length <= MAX_DP_DATA_URL_LENGTH &&
    DP_DATA_URL_PATTERN.test(value)
  );
}

export function parseDpUrl(value: unknown): string | null {
  return isValidDpDataUrl(value) ? value : null;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0
    ? name
        .slice(index + 1)
        .trim()
        .toLowerCase()
    : '';
}

async function looksLikeSvgOrMarkup(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  const text = new TextDecoder('utf-8', { fatal: false }).decode(head).trimStart().toLowerCase();
  return (
    text.startsWith('<svg') ||
    text.startsWith('<?xml') ||
    text.startsWith('<!doctype') ||
    text.startsWith('<html') ||
    text.includes('<svg')
  );
}

async function decodeImageSource(file: File): Promise<{
  width: number;
  height: number;
  draw: (
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    size: number,
  ) => void;
  close: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (ctx, sx, sy, sw, sh, size) => {
        ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, size, size);
      },
      close: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Invalid image'));
      element.src = objectUrl;
    });
    return {
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      draw: (ctx, sx, sy, sw, sh, size) => {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
      },
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

export type DpPrepareResult = { ok: true; dataUrl: string } | { ok: false; error: string };

export async function prepareDpImage(file: File): Promise<DpPrepareResult> {
  if (!file || file.size === 0) {
    return { ok: false, error: 'Choose a valid image file for your profile photo.' };
  }
  if (file.size > MAX_DP_INPUT_BYTES) {
    return { ok: false, error: 'Choose an image smaller than 10 MB.' };
  }

  const mime = (file.type || '').trim().toLowerCase();
  const ext = extensionOf(file.name || '');

  // Block SVG/XML/HTML/non-images strictly so only genuine raster images are accepted.
  if (mime.includes('svg') || ext === 'svg' || ext === 'svgz') {
    return { ok: false, error: 'SVG files are not allowed. Choose a photo or image file.' };
  }
  if (mime && !mime.startsWith('image/')) {
    return { ok: false, error: 'Only image files are allowed for your profile photo.' };
  }
  if (!mime && !IMAGE_EXTENSIONS.has(ext)) {
    return { ok: false, error: 'Only image files are allowed for your profile photo.' };
  }
  if (await looksLikeSvgOrMarkup(file)) {
    return { ok: false, error: 'Only valid image files are allowed for your profile photo.' };
  }

  let decoded: Awaited<ReturnType<typeof decodeImageSource>> | null = null;
  try {
    decoded = await decodeImageSource(file);
    if (decoded.width < 1 || decoded.height < 1) {
      return { ok: false, error: 'Only valid image files are allowed for your profile photo.' };
    }

    const side = Math.min(decoded.width, decoded.height);
    const sx = Math.max(0, Math.floor((decoded.width - side) / 2));
    const sy = Math.max(0, Math.floor((decoded.height - side) / 2));

    for (const targetSize of [160, 128, 96]) {
      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return { ok: false, error: 'Unable to process image in this browser.' };
      }
      ctx.clearRect(0, 0, targetSize, targetSize);
      decoded.draw(ctx, sx, sy, side, side, targetSize);

      for (const [format, quality] of [
        ['image/webp', 0.84],
        ['image/webp', 0.7],
        ['image/jpeg', 0.8],
        ['image/jpeg', 0.65],
      ] as const) {
        const encoded = canvas.toDataURL(format, quality);
        if (encoded.startsWith(`data:${format};base64,`) && isValidDpDataUrl(encoded)) {
          return { ok: true, dataUrl: encoded };
        }
      }
    }

    return { ok: false, error: 'Choose a simpler image for your profile photo.' };
  } catch {
    return { ok: false, error: 'Only valid image files are allowed for your profile photo.' };
  } finally {
    decoded?.close();
  }
}
