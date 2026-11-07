import {
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_MAX_EDGE,
  PROFILE_PHOTO_SOURCE_MAX_BYTES,
} from '@afhomes/contracts';

/** Browser-only decode/re-encode strips source metadata and bounds saved image size. */
export async function compressProfilePhoto(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose a JPEG, PNG or WebP image.');
  if (!file.size || file.size > PROFILE_PHOTO_SOURCE_MAX_BYTES)
    throw new Error('Choose an original image up to 10 MB.');
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Image loading timed out. Choose another photo.')),
        15000,
      );
      image.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      image.onerror = () => {
        clearTimeout(timer);
        reject(new Error('This image could not be opened.'));
      };
      image.src = url;
    });
    const width = image.naturalWidth,
      height = image.naturalHeight;
    if (!width || !height || width * height > 40_000_000)
      throw new Error('Choose an image with at most 40 megapixels.');
    const canvas = document.createElement('canvas'),
      context = canvas.getContext('2d');
    if (!context) throw new Error('Image compression is unavailable in this browser.');
    for (const edge of [PROFILE_PHOTO_MAX_EDGE, 256, 128]) {
      const scale = Math.min(1, edge / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.7, 0.55]) {
        const blob = await new Promise<Blob>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Image compression timed out.')), 15000);
          canvas.toBlob(
            (result) => {
              clearTimeout(timer);
              if (!result || result.type !== 'image/jpeg')
                reject(new Error('Could not compress this image.'));
              else resolve(result);
            },
            'image/jpeg',
            quality,
          );
        });
        if (blob.size > 0 && blob.size <= PROFILE_PHOTO_MAX_BYTES) return blob;
      }
    }
    throw new Error('Could not reduce this image to 0.5 MB. Choose another photo.');
  } finally {
    image.onload = null;
    image.onerror = null;
    image.src = '';
    URL.revokeObjectURL(url);
  }
}

export async function profilePhotoBase64(file: File): Promise<string> {
  const blob = await compressProfilePhoto(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the compressed photo.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result.split(',')[1] : null;
      if (!result) reject(new Error('Could not read the compressed photo.'));
      else resolve(result);
    };
    reader.readAsDataURL(blob);
  });
}
