import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const maxPrivatePdfBytes = 50 * 1024 * 1024;

export function localPrivatePdfPath(reference, storageDirectory) {
  if (!storageDirectory || typeof reference !== 'string') return null;
  const match = reference.match(/^\/private\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.pdf$/iu);
  if (!match) return null;
  return join(storageDirectory, `${match[1]}.pdf`);
}

export async function savePrivatePdf(buffer, storageDirectory) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('PDF content must be a Buffer.');
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    const error = new Error('The uploaded file is not a valid PDF.');
    error.status = 400;
    throw error;
  }
  if (buffer.length > maxPrivatePdfBytes) {
    const error = new Error('PDF uploads cannot exceed 50 MB.');
    error.status = 413;
    throw error;
  }
  const filename = `${randomUUID()}.pdf`;
  await mkdir(storageDirectory, { recursive: true });
  await writeFile(join(storageDirectory, filename), buffer, { flag: 'wx', mode: 0o600 });
  return { reference: `/private/${filename}`, sizeBytes: buffer.length };
}
