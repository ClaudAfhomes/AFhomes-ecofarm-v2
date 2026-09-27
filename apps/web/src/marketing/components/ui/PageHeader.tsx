import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Eyebrow } from "../../components/ui/Eyebrow";
import { CmsHeroMedia, useCmsHeroMedia } from "../../components/ui/CmsHeroMedia";
import { motion } from "motion/react";
import type { ImageSpec } from "../../lib/images";
import { EASE } from "../../lib/motion";

interface PageHeaderProps extends Omit<ComponentPropsWithoutRef<"header">, "title"> {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  /** Optional backdrop image. Uses the consistent image primitive (graceful fallback). */
  imageSpec?: ImageSpec;
}

/**
 * Dark cinematic header band used at the top of interior pages. When an image
 * is supplied it is used as the backdrop.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  imageSpec,
  className,
  children,
  ...props
}: PageHeaderProps) {
  const cmsHeroMedia = useCmsHeroMedia();
  return (
    <header
      className={cn("relative overflow-hidden bg-navy-950 text-cream-50", className)}
      {...props}
    >
      {(imageSpec || cmsHeroMedia) && (
        <motion.div
          className="absolute inset-0"
          initial={{ scale: 1.08 }}
          animate={{ scale: 1 }}
          transition={{ duration: 1.6, ease: EASE }}
        >
          <CmsHeroMedia fallback={imageSpec} />
        </motion.div>
      )}
      {!imageSpec && !cmsHeroMedia && (
        <div className="absolute inset-0 bg-gradient-to-b from-navy-900 to-navy-950" aria-hidden="true" />
      )}

      <div className="relative mx-auto flex min-h-[52vh] w-full max-w-[var(--container-site)] flex-col justify-end px-5 pt-32 pb-14 sm:px-8 sm:pb-20">
        {eyebrow && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }}>
            <Eyebrow tone="dark">{eyebrow}</Eyebrow>
          </motion.div>
        )}
        <motion.h1
          className="text-display mt-6 max-w-4xl text-balance text-cream-50"
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.1, ease: EASE }}
        >
          {title}
        </motion.h1>
        {lede && (
          <motion.p
            className="text-body-lg mt-6 max-w-2xl text-cream-200/85 text-pretty"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.25, ease: EASE }}
          >
            {lede}
          </motion.p>
        )}
        {children}
      </div>
    </header>
  );
}
