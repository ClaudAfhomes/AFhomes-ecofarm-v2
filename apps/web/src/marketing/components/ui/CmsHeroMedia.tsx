import { useLocation } from "react-router";
import { SmartImage } from "../../components/ui/SmartImage";
import { useCmsRevision } from "../../hooks/useCmsRevision";
import { cmsRepository } from "../../lib/cms";
import type { ImageSpec } from "../../lib/images";
import type { CmsMediaBlock } from "../../types/mediaBlock";

const overlayClasses = {
  light: "from-navy-950/55 via-navy-950/30 to-navy-950/20",
  medium: "from-navy-950/80 via-navy-950/55 to-navy-950/25",
  strong: "from-navy-950 via-navy-950/75 to-navy-950/40",
} as const;

const positionClasses = {
  center: "object-center",
  top: "object-top",
  bottom: "object-bottom",
} as const;

export function useCmsHeroMedia(): CmsMediaBlock | undefined {
  useCmsRevision();
  const { pathname } = useLocation();
  return cmsRepository.getMediaBlocks().find(
    (block) => block.page === pathname && block.placement === "page-background" && block.src,
  );
}

export function CmsHeroMedia({ fallback }: { fallback?: ImageSpec }) {
  const block = useCmsHeroMedia();
  const position = positionClasses[block?.position ?? "center"];

  return (
    <>
      {block?.kind === "video" ? (
        <video
          className={`absolute inset-0 h-full w-full object-cover ${position}`}
          src={block.src}
          autoPlay
          loop={block.loop ?? true}
          muted
          playsInline
          preload="metadata"
          aria-label={block.alt || undefined}
        />
      ) : block ? (
        <SmartImage
          spec={{ src: block.src, alt: block.alt }}
          priority
          className={`absolute inset-0 h-full w-full object-cover ${position}`}
          sizes="100vw"
        />
      ) : fallback ? (
        <SmartImage spec={fallback} priority className="absolute inset-0 h-full w-full object-cover object-center" sizes="100vw" />
      ) : null}
      {(block || fallback) && (
        <div
          className={`absolute inset-0 bg-gradient-to-t ${overlayClasses[block?.overlay ?? "medium"]}`}
          aria-hidden="true"
        />
      )}
    </>
  );
}
