import QRCode from 'qrcode';

/**
 * Renders a real QR code SVG into containerEl.
 * Uses the 'qrcode' library to generate a valid, scannable QR code.
 */
export async function generateQR(text, container) {
  try {
    const svgString = await QRCode.toString(text, {
      type: 'svg',
      color: {
        dark: '#191A23',  // Match brand dark color
        light: '#ffffff'
      },
      width: 160,
      margin: 1
    });
    container.innerHTML = svgString;
  } catch (err) {
    container.textContent = '';
  }
}
