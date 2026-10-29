import 'server-only';
import { crc32, deflateSync } from 'node:zlib';

const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength);
  out.set(Buffer.from(type, 'ascii'), 4);
  out.set(data, 8);
  view.setUint32(
    8 + data.byteLength,
    crc32(out.subarray(4, 8 + data.byteLength)),
  );
  return out;
}

/** Raw 8-bit RGB rows as a PNG, so the seed can make a picture without importing the image library outside its port. */
export function encodePng(
  rgb: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  if (rgb.byteLength !== width * height * 3) {
    throw new RangeError('The pixel buffer does not match the size');
  }
  const stride = width * 3;
  const filtered = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered.set(
      rgb.subarray(y * stride, (y + 1) * stride),
      y * (stride + 1) + 1,
    );
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(filtered, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
