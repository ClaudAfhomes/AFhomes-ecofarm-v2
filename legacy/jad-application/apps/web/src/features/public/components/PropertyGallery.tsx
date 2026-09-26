import { useState } from 'react';

import { ImageBlock } from '../../../components/ImageBlock';
import { REPRESENTATIVE_IMAGE_LABEL, photoSrcSet, photoUrl } from '../content';
import type { Photo } from '../content';
import styles from './PropertyGallery.module.css';

export interface PropertyGalleryProps {
  photos: Photo[];
}

/**
 * Detail-page gallery. Shows a large hero image with thumbnail buttons to
 * switch photos. Imagery is stock/representative - captioned as such - and the
 * thumbnails are real buttons (keyboard accessible, visible focus, aria-pressed
 * state) rather than clickable divs.
 */
export function PropertyGallery({ photos }: PropertyGalleryProps) {
  const [selected, setSelected] = useState(0);

  if (photos.length === 0) {
    return null;
  }

  const current = (photos[selected] ?? photos[0])!;
  const total = photos.length;

  return (
    <div className={styles.gallery}>
      <ImageBlock
        src={photoUrl(current.id, 1200)}
        srcSet={photoSrcSet(current.id, [480, 720, 960, 1200])}
        sizes="(min-width: 1024px) 58vw, 100vw"
        alt={current.alt}
        ratio="landscape"
        loading="eager"
        caption={REPRESENTATIVE_IMAGE_LABEL}
        className={styles.hero}
      />
      {total > 1 ? (
        <div className={styles.thumbs} role="group" aria-label="Property photos">
          {photos.map((photo, index) => {
            const isCurrent = index === selected;
            return (
              <button
                key={photo.id}
                type="button"
                className={`${styles.thumb} ${isCurrent ? styles.thumbActive : ''}`}
                onClick={() => setSelected(index)}
                aria-label={`View photo ${index + 1} of ${total}`}
                aria-pressed={isCurrent}
              >
                <img
                  src={photoUrl(photo.id, 240)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={styles.thumbImage}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
