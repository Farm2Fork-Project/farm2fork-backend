import { v2 as cloudinary } from 'cloudinary';
import { avatarUrl } from './avatar';

describe('avatarUrl', () => {
  afterEach(() => {
    cloudinary.config({ cloud_name: undefined });
  });

  it('has no URL without a stored path', () => {
    expect(avatarUrl(undefined)).toBeUndefined();
    expect(avatarUrl('')).toBeUndefined();
  });

  it('builds a Cloudinary delivery URL with the crop applied at delivery', () => {
    cloudinary.config({ cloud_name: 'demo-cloud' });
    expect(avatarUrl('v1699999999/farm2fork/avatars/64b7f0c2a1')).toBe(
      'https://res.cloudinary.com/demo-cloud/image/upload/c_fill,g_auto,w_256,h_256,f_auto,q_auto/v1699999999/farm2fork/avatars/64b7f0c2a1',
    );
    expect(avatarUrl('v1/farm2fork/avatars/abc', 96)).toContain('w_96,h_96');
  });

  it('refuses a path that is not an avatar path, so a URL cannot be smuggled in', () => {
    cloudinary.config({ cloud_name: 'demo-cloud' });
    expect(avatarUrl('https://evil.example/x.png')).toBeUndefined();
    expect(avatarUrl('v1/other/folder/abc')).toBeUndefined();
    expect(avatarUrl('v1/farm2fork/avatars/abc/../../x')).toBeUndefined();
  });

  it('has no Cloudinary URL when Cloudinary is not configured', () => {
    expect(avatarUrl('v1/farm2fork/avatars/abc')).toBeUndefined();
  });

  it('serves local development files from the API', () => {
    expect(avatarUrl('local:0123456789abcdef0123456789abcdef.jpg')).toBe(
      '/api/files/public/0123456789abcdef0123456789abcdef.jpg',
    );
  });
});
