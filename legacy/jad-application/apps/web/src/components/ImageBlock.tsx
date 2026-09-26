import { useState } from 'react';

import styles from './ImageBlock.module.css';

export type ImageRatio = 'wide' | 'landscape' | 'portrait' | 'tall' | 'square';

export interface ImageBlockProps {
  src: string;
  alt: string;
  /** Display ratio of the box the image fills (prevents layout shift). */
  ratio?: ImageRatio;
  /** Optional responsive source set (e.g. from `photoSrcSet`) + hint. */
  srcSet?: string;
  sizes?: string;
  loading?: 'lazy' | 'eager';
  /** Optional caption rendered under the image. */
  caption?: string;
  className?: string;
  /** Optional class for the inner frame (e.g. a larger editorial radius). */
  frameClassName?: string;
}

/**
 * Responsive image block for site photography. Remote images are lazy-loaded
 * below the fold, given a fixed aspect ratio to prevent layout shift, and fall
 * back to a neutral panel if the image cannot load - never a broken-image icon.
 */
export function ImageBlock({
  src,
  alt,
  ratio = 'landscape',
  srcSet,
  sizes,
  loading = 'lazy',
  caption,
  className,
  frameClassName,
}: ImageBlockProps) {
  const [failed, setFailed] = useState(false);

  return (
    <figure className={`${styles.figure} ${className ?? ''}`}>
      <div className={`${styles.frame} ${styles[ratio]} ${frameClassName ?? ''}`}>
        {failed ? (
          <div className={styles.fallback} role="img" aria-label={alt}>
            <span aria-hidden="true">Image unavailable</span>
          </div>
        ) : (
          <img
            className={styles.image}
            src={src}
            srcSet={srcSet}
            sizes={sizes}
            alt={alt}
            loading={loading}
            decoding="async"
            onError={() => setFailed(true)}
          />
        )}
      </div>
      {caption ? <figcaption className={styles.caption}>{caption}</figcaption> : null}
    </figure>
  );
}
