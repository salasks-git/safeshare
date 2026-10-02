// test/files.test.ts
// Tests for magic-byte detection and filename sanitization.

import { describe, it, expect } from 'vitest';
import { detectMime, sanitizeFilename } from '../src/files';

describe('detectMime', () => {
  it('accepts PDF by magic bytes', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    expect(detectMime(bytes)).toBe('application/pdf');
  });

  it('accepts JPEG', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(detectMime(bytes)).toBe('image/jpeg');
  });

  it('accepts PNG', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectMime(bytes)).toBe('image/png');
  });

  it('rejects EXE disguised as PDF (wrong magic)', () => {
    const bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(detectMime(bytes)).toBeNull();
  });

  it('rejects empty bytes', () => {
    expect(detectMime(new Uint8Array(0))).toBeNull();
  });
});

describe('sanitizeFilename', () => {
  it('strips path traversal', () => {
    const result = sanitizeFilename('../../../etc/passwd');
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
    // The dangerous '..' traversal sequence should not appear intact
    expect(result).not.toMatch(/\.\./);
  });

  it('strips control characters', () => {
    const name = 'file\x00\x01name.pdf';
    expect(sanitizeFilename(name)).not.toMatch(/[\x00-\x1f]/);
  });

  it('caps length at 200', () => {
    const long = 'a'.repeat(300) + '.pdf';
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(200);
  });

  it('handles empty input', () => {
    expect(sanitizeFilename('')).toBe('file');
  });

  it('keeps normal filenames intact', () => {
    expect(sanitizeFilename('report_q3.pdf')).toBe('report_q3.pdf');
  });
});
