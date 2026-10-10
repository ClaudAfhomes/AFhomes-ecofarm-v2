export const extensionFor = (mime: string) =>
  ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
  })[mime];

export function signatureMatches(mime: string, bytes: Uint8Array): boolean {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png')
    return (
      bytes.length >= 8 &&
      bytes.slice(0, 8).every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i])
    );
  if (mime === 'image/gif')
    return (
      Buffer.from(bytes.slice(0, 6))
        .toString('ascii')
        .match(/^GIF8[79]a$/) !== null
    );
  if (mime === 'image/webp')
    return (
      Buffer.from(bytes.slice(0, 4)).toString('ascii') === 'RIFF' &&
      Buffer.from(bytes.slice(8, 12)).toString('ascii') === 'WEBP'
    );
  if (mime === 'video/mp4') return Buffer.from(bytes.slice(4, 8)).toString('ascii') === 'ftyp';
  return false;
}
