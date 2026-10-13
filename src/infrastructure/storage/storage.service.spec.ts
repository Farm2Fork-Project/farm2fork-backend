import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { StorageService } from './storage.service';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const PDF = Buffer.from('%PDF-1.7\n%%EOF');

describe('StorageService (local fallback)', () => {
  let dir: string;
  let storage: StorageService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'f2f-storage-'));
    const values: Record<string, string> = {
      UPLOAD_DIR: dir,
      JWT_SECRET: 'test-secret',
    };
    storage = new StorageService({
      get: (key: string) => values[key],
    } as ConfigService);
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('validates by content, not the declared type', () => {
    expect(() =>
      storage.validate(Buffer.from('<script>alert(1)</script>'), 'image'),
    ).toThrow('Only JPEG, PNG or WebP images are accepted');
    expect(() => storage.validate(PDF, 'image')).toThrow();
    expect(storage.validate(PDF, 'document').mimeType).toBe('application/pdf');
    expect(() =>
      storage.validate(Buffer.alloc(11 * 1024 * 1024, 0xff), 'document'),
    ).toThrow('File exceeds 10 MB');
  });

  it('serves public images by URL', async () => {
    const url = await storage.uploadPublicImage(PNG, 'posts');
    const name = url.split('/').pop()!;
    expect(url).toBe(`/api/files/public/${name}`);
    await expect(storage.readLocal('public', name)).resolves.toEqual({
      buffer: PNG,
      mimeType: 'image/png',
    });
  });

  it('serves private documents only with a valid, unexpired signature', async () => {
    const ref = await storage.uploadPrivateDocument(PDF, 'loans');
    expect(ref).toMatch(/^local:[a-f0-9]{32}\.pdf$/);
    const url = new URL(storage.signedUrl(ref), 'http://api.test');
    const name = url.pathname.split('/').pop()!;
    const exp = url.searchParams.get('exp')!;
    const sig = url.searchParams.get('sig')!;

    await expect(
      storage.readLocal('private', name, { exp, sig }),
    ).resolves.toEqual(
      expect.objectContaining({ mimeType: 'application/pdf' }),
    );
    await expect(storage.readLocal('private', name)).resolves.toBeNull();
    await expect(
      storage.readLocal('private', name, { exp: String(Number(exp) + 1), sig }),
    ).resolves.toBeNull();
    await expect(
      storage.readLocal('private', name, { exp: '1', sig }),
    ).resolves.toBeNull();
    // Private files are never reachable through the public route.
    await expect(storage.readLocal('public', name)).resolves.toBeNull();
  });

  it('rejects path traversal in file names', async () => {
    await expect(
      storage.readLocal('public', '../../etc/passwd'),
    ).resolves.toBeNull();
  });
});

describe('StorageService avatars', () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
  const userId = '64b7f0c2a1b2c3d4e5f60718';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const withCloudinary = () =>
    new StorageService({
      get: (key: string) =>
        key === 'CLOUDINARY_URL' ? 'cloudinary://key:secret@demo' : undefined,
    } as ConfigService);

  it('uploads to a per-user public_id and returns only the delivery path', async () => {
    const upload = jest
      .spyOn(cloudinary.uploader, 'upload_stream')
      .mockImplementation(
        (
          _options: unknown,
          callback: (error: unknown, result: unknown) => void,
        ) => {
          callback(undefined, {
            public_id: `farm2fork/avatars/${userId}`,
            version: 1700000000,
            format: 'jpg',
            secure_url: 'https://res.cloudinary.com/demo/ignored',
          });
          return { end: jest.fn() };
        },
      );

    const path = await withCloudinary().uploadAvatar(JPEG, userId);

    expect(path).toBe(`v1700000000/farm2fork/avatars/${userId}`);
    expect(upload.mock.calls[0][0]).toMatchObject({
      public_id: `farm2fork/avatars/${userId}`,
      overwrite: true,
      invalidate: true,
      resource_type: 'image',
      allowed_formats: ['jpg', 'png', 'webp'],
      transformation: [{ width: 1024, height: 1024, crop: 'limit' }],
    });
  });

  it('rejects non-image content before anything leaves the server', async () => {
    const upload = jest.spyOn(cloudinary.uploader, 'upload_stream');
    await expect(
      withCloudinary().uploadAvatar(Buffer.from('<svg onload=x>'), userId),
    ).rejects.toThrow('Only JPEG, PNG or WebP images are accepted');
    expect(upload).not.toHaveBeenCalled();
  });

  it('deletes by public_id, invalidating the CDN copy, and ignores foreign paths', async () => {
    const destroy = jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'ok' });
    const storage = withCloudinary();
    await storage.deleteAvatar(`v9/farm2fork/avatars/${userId}`);
    expect(destroy).toHaveBeenCalledWith(`farm2fork/avatars/${userId}`, {
      resource_type: 'image',
      type: 'upload',
      invalidate: true,
    });
    await storage.deleteAvatar('v9/someone/elses/asset');
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
