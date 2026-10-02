// src/js/compress.js
// Client-side image compression before upload.
// Compresses JPEG/PNG/WebP to max 2000px, quality ~0.82, using Canvas.
// PDFs are not modified.
// Usage: import { compressImageFile } from './compress.js'

/**
 * Compresses an image File to a maximum of 2000px on any side, quality 0.82.
 * Returns the original file if it's a PDF, already small, or compression fails.
 */
export async function compressImageFile(file) {
  // Only compress images, not PDFs
  if (file.type === 'application/pdf') return file;
  if (!file.type.startsWith('image/')) return file;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 2000;
      let { width, height } = img;

      // Scale down if either dimension exceeds MAX
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Output as JPEG for photos, PNG for images that might have transparency
      const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const quality = outType === 'image/jpeg' ? 0.82 : undefined;

      canvas.toBlob((blob) => {
        if (!blob || blob.size >= file.size) {
          // If compression doesn't help, use original
          resolve(file);
        } else {
          resolve(new File([blob], file.name, { type: outType }));
        }
      }, outType, quality);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file); // Use original on error
    };

    img.src = url;
  });
}
