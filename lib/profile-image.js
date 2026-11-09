export const MAX_PROFILE_IMAGE_BYTES = 128 * 1024;

// Solo il salvataggio del profilo deve poter contenere una foto in base64.
export function requestBodyLimit(method, pathname) {
  return method === 'PATCH' && pathname === '/api/me' ? 192 * 1024 : 16 * 1024;
}

export function validProfileImage(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_PROFILE_IMAGE_BYTES / 3) * 4 + 32) return false;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_PROFILE_IMAGE_BYTES || bytes.toString('base64') !== match[2]) return false;
  if (match[1] === 'jpeg') return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (match[1] === 'png') return bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR';
  return bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16));
}
