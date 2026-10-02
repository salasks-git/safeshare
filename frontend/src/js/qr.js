// src/js/qr.js
// Minimal QR code generator (pure JS, no external dependency).
// Usage: import { generateQR } from './qr.js'
//        generateQR(text, containerEl)
// Draws a QR-like SVG inside containerEl.

/**
 * Renders a visual QR placeholder SVG into containerEl.
 * The finder patterns are accurate; the data cells are deterministic
 * based on a hash of the text so each code looks distinct.
 * In production this could be swapped for a real QR encoder.
 * The code is shown numerically anyway so users can always type it.
 */
export function generateQR(text, container) {
  try {
    const svg = createQRSvg(text);
    container.innerHTML = svg;
  } catch {
    container.textContent = '';
  }
}

function createQRSvg(text) {
  // Deterministic hash of the text for visual uniqueness
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }

  const SIZE = 160;
  const CELLS = 21; // QR version 1
  const CELL = Math.floor(SIZE / CELLS);
  const rects = [];

  for (let r = 0; r < CELLS; r++) {
    for (let c = 0; c < CELLS; c++) {
      // Always render the three finder patterns
      const inFinder =
        (r < 7 && c < 7) ||           // top-left
        (r < 7 && c >= CELLS - 7) ||  // top-right
        (r >= CELLS - 7 && c < 7);    // bottom-left

      let dark = false;
      if (inFinder) {
        const lr = r < 7 ? r : r - (CELLS - 7);
        const lc = c < 7 ? c : c - (CELLS - 7);
        dark = lr === 0 || lr === 6 || lc === 0 || lc === 6 ||
               (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4);
      } else {
        // Deterministic fill based on hash and position
        const seed = (hash ^ (r * 31) ^ (c * 17)) >>> 0;
        dark = (seed % 3) === 0;
      }

      if (dark) {
        rects.push(`<rect x="${c * CELL}" y="${r * CELL}" width="${CELL}" height="${CELL}" fill="#141722"/>`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
    <rect width="${SIZE}" height="${SIZE}" fill="white"/>
    ${rects.join('')}
  </svg>`;
}
