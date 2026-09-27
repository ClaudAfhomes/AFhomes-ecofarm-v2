import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Container } from "../../components/ui/Container";
import { AnimatedText } from "../../components/ui/AnimatedText";
import { Button } from "../../components/ui/Button";
import { ScrollIndicator } from "../../components/ui/ScrollIndicator";
import { CmsHeroMedia } from "../../components/ui/CmsHeroMedia";
import { getPlaceholder } from "../../lib/images";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { EASE } from "../../lib/motion";
import { cmsRepository } from "../../lib/cms";

export function Hero() {
  const content = cmsRepository.getPageContent().home;
  const titleParts = content.heroTitle.split(/(?<=\.)\s+/, 2);
  const ref = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const coarsePointer = useMediaQuery("(pointer: coarse)");
  /* Parallax stays on desktop pointers — on touch devices the scroll-linked
     movement fights the user's own gestures and feels heavy. */
  const allowParallax = !reducedMotion && !coarsePointer;
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  const parallaxY = useTransform(scrollYProgress, [0, 1], ["0%", "18%"]);
  const parallaxScale = useTransform(scrollYProgress, [0, 1], [1.1, 1.22]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.65], [1, 0]);

  const heroImage = getPlaceholder("resort-valley");

  return (
    <section ref={ref} className="relative flex min-h-svh items-end overflow-hidden bg-pine-950">
      {/* Background */}
      <motion.div
        className="absolute inset-0"
        style={allowParallax ? { y: parallaxY, scale: parallaxScale } : undefined}
        aria-hidden="true"
      >
        <CmsHeroMedia fallback={heroImage} />
      </motion.div>

      {/* Content */}
      <motion.div
        className="relative z-10 w-full"
        style={allowParallax ? { opacity: contentOpacity } : undefined}
      >
        <Container className="pb-28 pt-40 sm:pb-36">
          <motion.p
            className="label-caps flex items-center gap-3 text-cream-200/80"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.8, ease: EASE }}
          >
            <span className="h-px w-10 bg-leaf-400" aria-hidden="true" />
            {content.heroBadge}
          </motion.p>

          <h1 className="mt-8 max-w-5xl">
            <span className="font-display block text-[clamp(2.75rem,7vw,6.5rem)] leading-[0.95] font-medium text-cream-50 text-balance">
              <AnimatedText text={titleParts[0] ?? ""} delay={0.15} />
            </span>
            <span className="font-display mt-4 block text-[clamp(1.75rem,4vw,3.5rem)] leading-[1.05] font-light text-cream-100 text-balance">
              <AnimatedText text={titleParts[1] ?? ""} delay={0.3} />
            </span>
          </h1>

          <motion.p
            className="mt-8 max-w-xl text-lg leading-relaxed text-cream-200/85 text-pretty sm:text-xl"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.8, ease: EASE }}
          >
            {content.heroLede}
          </motion.p>

          <motion.div
            className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.8, ease: EASE }}
          >
            <Button to="/experiences" variant="accent" size="lg" withArrow>
              {content.heroPrimaryCta}
            </Button>
            <Button to="/vip" variant="outline-light" size="lg" className="border-cream-50/50">
              {content.heroSecondaryCta}
            </Button>
          </motion.div>
        </Container>
      </motion.div>

      <ScrollIndicator />
    </section>
  );
}
