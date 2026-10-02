// src/files.ts
// File validation: magic bytes, filename sanitization, size/count checks.
// SECURITY NOTE: We only read a few bytes — never parse or execute file contents.

/** Allowed MIME types and their magic byte signatures */
const ALLOWED: Array<{ mime: string; magic: number[] }> = [
  { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] },          // %PDF
  { mime: 'image/jpeg',      magic: [0xff, 0xd8, 0xff] },                  // JPEG
  { mime: 'image/png',       magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a] }, // PNG
  { mime: 'image/webp',      magic: [0x52, 0x49, 0x46, 0x46] },           // RIFF (WebP)
];

const MAX_MAGIC_BYTES = 8;

/**
 * Checks the first bytes of a buffer against known magic signatures.
 * Returns the allowed MIME type string, or null if rejected.
 */
export function detectMime(firstBytes: Uint8Array): string | null {
  for (const { mime, magic } of ALLOWED) {
    if (magic.every((b, i) => firstBytes[i] === b)) {
      // Extra check: WebP files have 'WEBP' at bytes 8-11
      if (mime === 'image/webp') {
        if (
          firstBytes[8] === 0x57 && // W
          firstBytes[9] === 0x45 && // E
          firstBytes[10] === 0x42 && // B
          firstBytes[11] === 0x50   // P
        ) {
          return mime;
        }
        continue;
      }
      return mime;
    }
  }
  return null;
}

/** Maximum bytes needed for magic detection */
export const MAGIC_PEEK_BYTES = 12;

/**
 * Sanitizes a filename: strips path separators, control chars, and limits length.
 * Returns the cleaned name, never empty.
 */
export function sanitizeFilename(raw: string): string {
  // Remove any path components
  let name = raw.replace(/[/\\]/g, '_');
  // Strip '..' traversal sequences
  name = name.replace(/\.\./g, '');
  // Strip control characters and null bytes
  name = name.replace(/[\x00-\x1f\x7f]/g, '');
  // Trim whitespace and dots from edges
  name = name.trim().replace(/^\.+|\.+$/g, '') || 'file';
  // Cap at 200 characters
  if (name.length > 200) name = name.slice(0, 200);
  return name || 'file';
}
