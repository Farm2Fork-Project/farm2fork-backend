/**
 * Upload validation by content, not by the client-supplied MIME type: the
 * first bytes must match one of the allowed formats.
 */
export type UploadKind = 'image' | 'document';

export interface DetectedFile {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  extension: 'jpg' | 'png' | 'webp' | 'pdf';
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export function detectFile(buffer: Buffer): DetectedFile | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  if (
    buffer.length >= 5 &&
    buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  ) {
    return { mimeType: 'application/pdf', extension: 'pdf' };
  }
  return null;
}

/** Images accept JPEG/PNG/WebP; documents additionally accept PDF. */
export function isAllowed(kind: UploadKind, file: DetectedFile): boolean {
  return kind === 'document' || file.mimeType !== 'application/pdf';
}
