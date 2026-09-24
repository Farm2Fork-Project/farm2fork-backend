import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { mkdir, readFile, realpath, writeFile } from 'fs/promises';
import { basename, join, resolve, sep } from 'path';
import {
  DetectedFile,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  UploadKind,
  detectFile,
  isAllowed,
} from './file-kind';

/**
 * Stored-file reference kept in the database. Public images store a URL the
 * client can load directly; private documents store an opaque ref that is
 * only ever turned into a short-lived signed URL for an authorized reader.
 *
 *   cloudinary:<resource_type>:<public_id>.<ext>   (type "authenticated")
 *   local:<file name>                              (dev fallback)
 */
export type PrivateFileRef = string;

const SIGNED_URL_TTL_SECONDS = 10 * 60;
const LOCAL_FILE_NAME = /^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/;

/**
 * Uploads to Cloudinary when CLOUDINARY_URL is set (the SDK reads it from the
 * environment). Without it, files go to UPLOAD_DIR and are served by
 * FilesController - intended for local development and tests only.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly useCloudinary: boolean;
  private readonly uploadDir: string;
  private readonly signingSecret: string;

  constructor(config: ConfigService) {
    this.useCloudinary = Boolean(config.get<string>('CLOUDINARY_URL'));
    this.uploadDir = resolve(config.get<string>('UPLOAD_DIR') ?? 'uploads');
    this.signingSecret =
      config.get<string>('JWT_SECRET') ?? randomBytes(32).toString('hex');
    if (this.useCloudinary) {
      cloudinary.config({ secure: true });
    } else {
      this.logger.warn(
        `CLOUDINARY_URL is not set - uploads are stored on local disk in ${this.uploadDir} (development only)`,
      );
    }
  }

  get backend(): 'cloudinary' | 'local' {
    return this.useCloudinary ? 'cloudinary' : 'local';
  }

  /** Validates by content and size; returns the detected format. */
  validate(buffer: Buffer | undefined, kind: UploadKind): DetectedFile {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('A file is required');
    }
    const max = kind === 'image' ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
    if (buffer.length > max) {
      throw new PayloadTooLargeException(
        `File exceeds ${max / (1024 * 1024)} MB`,
      );
    }
    const detected = detectFile(buffer);
    if (!detected || !isAllowed(kind, detected)) {
      throw new BadRequestException(
        kind === 'image'
          ? 'Only JPEG, PNG or WebP images are accepted'
          : 'Only PDF, JPEG, PNG or WebP documents are accepted',
      );
    }
    return detected;
  }

  /** Stores a publicly readable image and returns its URL. */
  async uploadPublicImage(buffer: Buffer, folder: string): Promise<string> {
    const file = this.validate(buffer, 'image');
    if (this.useCloudinary) {
      const result = await this.cloudinaryUpload(buffer, {
        folder: `farm2fork/${folder}`,
        resource_type: 'image',
        type: 'upload',
      });
      return result.secure_url;
    }
    const name = await this.writeLocal('public', buffer, file);
    // Root-relative: clients resolve it against the API origin.
    return `/api/files/public/${name}`;
  }

  /** Stores a private document and returns an opaque reference. */
  async uploadPrivateDocument(
    buffer: Buffer,
    folder: string,
  ): Promise<PrivateFileRef> {
    const file = this.validate(buffer, 'document');
    if (this.useCloudinary) {
      const resourceType =
        file.mimeType === 'application/pdf' ? 'raw' : 'image';
      const result = await this.cloudinaryUpload(buffer, {
        folder: `farm2fork/${folder}`,
        resource_type: resourceType,
        type: 'authenticated',
        // Raw uploads keep the extension in the public id.
        ...(resourceType === 'raw'
          ? { public_id: `${randomBytes(16).toString('hex')}.pdf` }
          : {}),
      });
      const publicId =
        resourceType === 'raw'
          ? result.public_id
          : `${result.public_id}.${result.format}`;
      return `cloudinary:${resourceType}:${publicId}`;
    }
    const name = await this.writeLocal('private', buffer, file);
    return `local:${name}`;
  }

  /** Short-lived URL for a private document. Never log the result. */
  signedUrl(ref: PrivateFileRef): string {
    const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const cloud = /^cloudinary:(image|raw):(.+\.[a-z]+)$/.exec(ref);
    if (cloud) {
      const [, resourceType, publicIdWithExt] = cloud;
      const dot = publicIdWithExt.lastIndexOf('.');
      const format = publicIdWithExt.slice(dot + 1);
      const publicId =
        resourceType === 'raw'
          ? publicIdWithExt
          : publicIdWithExt.slice(0, dot);
      return cloudinary.utils.private_download_url(publicId, format, {
        resource_type: resourceType,
        type: 'authenticated',
        expires_at: expiresAt,
        attachment: false,
      });
    }
    if (ref.startsWith('local:')) {
      const name = ref.slice('local:'.length);
      const sig = this.sign(name, expiresAt);
      return `/api/files/private/${name}?exp=${expiresAt}&sig=${sig}`;
    }
    throw new BadRequestException('Unknown file reference');
  }

  async readLocal(
    scope: 'public' | 'private',
    name: string,
    signature?: { exp: string; sig: string },
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    if (!LOCAL_FILE_NAME.test(name)) return null;
    const safeName = basename(name);
    if (safeName !== name) return null;
    if (scope === 'private') {
      const exp = Number(signature?.exp);
      if (!Number.isInteger(exp) || exp < Date.now() / 1000) return null;
      const expected = Buffer.from(this.sign(name, exp));
      const actual = Buffer.from(signature?.sig ?? '');
      if (
        expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)
      ) {
        return null;
      }
    }
    try {
      const baseDir = resolve(this.uploadDir, scope);
      const filePath = join(baseDir, safeName);
      if (filePath !== baseDir && !filePath.startsWith(`${baseDir}${sep}`)) {
        return null;
      }
      const realBaseDir = await realpath(baseDir);
      const realFilePath = await realpath(filePath);
      if (
        realFilePath !== realBaseDir &&
        !realFilePath.startsWith(`${realBaseDir}${sep}`)
      ) {
        return null;
      }
      const buffer = await readFile(realFilePath);
      return {
        buffer,
        mimeType: detectFile(buffer)?.mimeType ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  private sign(name: string, exp: number): string {
    return createHmac('sha256', this.signingSecret)
      .update(`${name}:${exp}`)
      .digest('hex');
  }

  private async writeLocal(
    scope: 'public' | 'private',
    buffer: Buffer,
    file: DetectedFile,
  ): Promise<string> {
    const dir = join(this.uploadDir, scope);
    await mkdir(dir, { recursive: true });
    const name = `${randomBytes(16).toString('hex')}.${file.extension}`;
    await writeFile(join(dir, name), buffer);
    return name;
  }

  private cloudinaryUpload(
    buffer: Buffer,
    options: Record<string, unknown>,
  ): Promise<{ secure_url: string; public_id: string; format: string }> {
    return new Promise((resolvePromise, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        options,
        (error, result) => {
          if (error || !result) {
            this.logger.error(
              `Cloudinary upload failed: ${error?.message ?? 'no result'}`,
            );
            reject(
              new BadRequestException('File upload failed, please try again'),
            );
            return;
          }
          resolvePromise(result);
        },
      );
      stream.end(buffer);
    });
  }
}
