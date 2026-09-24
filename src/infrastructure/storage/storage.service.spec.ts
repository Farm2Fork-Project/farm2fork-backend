import { ConfigService } from '@nestjs/config';
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
