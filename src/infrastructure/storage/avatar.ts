import { v2 as cloudinary } from 'cloudinary';

/** Cloudinary public_id prefix; the user id completes it (one avatar per user). */
export const AVATAR_PUBLIC_ID_PREFIX = 'farm2fork/avatars';

/** `v<version>/farm2fork/avatars/<userId>` - the Cloudinary delivery path. */
export const AVATAR_PATH = /^v\d+\/farm2fork\/avatars\/[A-Za-z0-9]+$/;

/**
 * Delivery URL for a stored avatar path. Only the path is kept in MongoDB; the
 * crop and size are applied by Cloudinary at delivery time (official URL
 * transformations): `c_fill,g_auto` is a plain scale for the already-square
 * upload and keeps the subject if anything else is ever stored, `f_auto,q_auto`
 * serve the lightest format the client supports.
 *
 * Returns undefined when there is no avatar, or Cloudinary is not configured
 * and the path is not a local development file.
 */
export function avatarUrl(
  path: string | null | undefined,
  size = 256,
): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('local:')) {
    return `/api/files/public/${path.slice('local:'.length)}`;
  }
  const cloudName = cloudinary.config().cloud_name;
  if (!cloudName || !AVATAR_PATH.test(path)) return undefined;
  return `https://res.cloudinary.com/${cloudName}/image/upload/c_fill,g_auto,w_${size},h_${size},f_auto,q_auto/${path}`;
}
