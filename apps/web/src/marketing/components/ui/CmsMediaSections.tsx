import { cmsRepository } from "../../lib/cms";
import { useCmsRevision } from "../../hooks/useCmsRevision";
import { SmartImage } from "../../components/ui/SmartImage";
import { Container } from "../../components/ui/Container";
import type { CmsMediaPlacement } from "../../types/mediaBlock";

export function CmsMediaSections({ page, placement }: { page: string; placement: CmsMediaPlacement }) {
  useCmsRevision();
  const blocks = cmsRepository.getMediaBlocks().filter((block) => block.page === page && block.placement === placement);
  if (!blocks.length) return null;

  return <section className="bg-cream-100 py-8 sm:py-12" aria-label="Page media">
    <div className="space-y-8 sm:space-y-12">
      {blocks.map((block) => {
        const media = block.kind === "video"
          ? <video
              className={`max-h-[80svh] w-full ${block.fit === "contain" ? "object-contain" : "object-cover"}`}
              controls={!block.autoplay}
              autoPlay={block.autoplay}
              loop={block.loop}
              muted={block.autoplay || block.muted}
              playsInline
              preload="metadata"
              aria-label={block.alt || undefined}
            ><source src={block.src} /></video>
          : <SmartImage spec={{ src: block.src, alt: block.alt }} className={`max-h-[80svh] min-h-64 w-full ${block.fit === "contain" ? "object-contain" : "object-cover"}`} sizes="100vw" />;
        const figure = <figure className="overflow-hidden bg-cream-50 shadow-soft">{media}{block.caption && <figcaption className="px-5 py-4 text-sm leading-relaxed text-ink-600">{block.caption}</figcaption>}</figure>;
        if (block.width === "full") return <div key={block.id}>{figure}</div>;
        return <Container key={block.id} size={block.width === "content" ? "narrow" : "site"}>{figure}</Container>;
      })}
    </div>
  </section>;
}
