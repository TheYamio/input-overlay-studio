/** Read dimensions before asking a decoder to allocate a raster. */
export function rasterDimensions(data: string, bytes?: Uint8Array): { width: number; height: number } | null {
  try {
    const [header, encoded] = data.split(',');
    const b = bytes || Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const view = new DataView(b.buffer);
    const tag = (offset: number, text: string) => [...text].every((c, i) => b[offset + i] === c.charCodeAt(0));
    if (header === 'data:image/png;base64' && b.length >= 33 && tag(0, '\x89PNG\r\n\x1a\n') && view.getUint32(8) === 13 && tag(12, 'IHDR')) return { width: view.getUint32(16), height: view.getUint32(20) };
    if (header === 'data:image/jpeg;base64' && b[0] === 255 && b[1] === 216) {
      let i = 2;
      while (i + 3 < b.length) {
        if (b[i++] !== 255) return null;
        while (b[i] === 255) i++;
        const marker = b[i++];
        if (marker === 217 || marker === 218) return null;
        const length = view.getUint16(i);
        if (length < 2 || i + length > b.length) return null;
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) return { width: view.getUint16(i + 5), height: view.getUint16(i + 3) };
        i += length;
      }
    }
    if (header === 'data:image/webp;base64' && b.length >= 25 && tag(0, 'RIFF') && tag(8, 'WEBP') && view.getUint32(4, true) + 8 === b.length) {
      const u24 = (i: number) => b[i] + (b[i + 1] << 8) + (b[i + 2] << 16);
      if (tag(12, 'VP8X') && b.length >= 30) return { width: 1 + u24(24), height: 1 + u24(27) };
      if (tag(12, 'VP8L') && b[20] === 47) return { width: 1 + b[21] + ((b[22] & 63) << 8), height: 1 + (b[22] >> 6) + (b[23] << 2) + ((b[24] & 15) << 10) };
      if (tag(12, 'VP8 ') && b.length >= 30 && tag(23, '\x9d\x01\x2a')) return { width: view.getUint16(26, true) & 16383, height: view.getUint16(28, true) & 16383 };
    }
  } catch { /* Truncated or malformed Base64/header. */ }
  return null;
}
