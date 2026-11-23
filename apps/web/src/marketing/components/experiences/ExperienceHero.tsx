import { motion } from "motion/react";
import { Container } from "../../components/ui/Container";
import { Button } from "../../components/ui/Button";
import { CmsHeroMedia } from "../../components/ui/CmsHeroMedia";
import { StatusBadge } from "../../components/ui/Badge";
import { cn } from "../../lib/cn";
import type { Experience } from "../../types/experience";
import { EASE } from "../../lib/motion";

interface ExperienceHeroProps {
  experience: Experience;
}

const ACCENT_HAIRLINE: Record<string, string> = {
  cyan: "bg-cyan-400",
  coral: "bg-coral-400",
  leaf: "bg-leaf-500",
};

export function ExperienceHero({ experience }: ExperienceHeroProps) {
  return (
    <header className="relative flex min-h-[86svh] items-end overflow-hidden bg-navy-950 text-cream-50">
      <motion.div
        className="absolute inset-0"
        initial={{ scale: 1.12 }}
        animate={{ scale: 1 }}
        transition={{ duration: 1.8, ease: EASE }}
        aria-hidden="true"
      >
        <CmsHeroMedia fallback={experience.image} />
      </motion.div>

      <Container className="relative pb-20 pt-36 sm:pb-28 sm:pt-44">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.7, ease: EASE }}
        >
          <StatusBadge
            status={experience.status}
            label={experience.statusLabel}
            className="border-white/15 bg-white/10 text-cream-100 backdrop-blur-sm"
          />
        </motion.div>

        <motion.p
          className="label-caps mt-6 flex items-center gap-3 text-cream-200/80"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.7, ease: EASE }}
        >
          <span
            className={cn("h-px w-8", ACCENT_HAIRLINE[experience.accent] ?? "bg-coral-400")}
            aria-hidden="true"
          />
          {experience.location}
        </motion.p>

        <motion.h1
          className="font-display mt-4 max-w-4xl text-5xl leading-[0.98] font-medium text-balance sm:text-6xl lg:text-7xl"
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.9, ease: EASE }}
        >
          {experience.name}
        </motion.h1>

        <motion.p
          className="font-display mt-4 max-w-2xl text-2xl leading-snug text-cream-200/90 italic sm:text-3xl"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.8, ease: EASE }}
        >
          {experience.headline}
        </motion.p>

        <motion.div
          className="mt-9 flex flex-col gap-3 sm:flex-row"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.8, ease: EASE }}
        >
          <Button to="/contact" variant="accent" size="lg" withArrow>
            Enquire with AFhomes
          </Button>
          <Button to="/experiences" variant="outline-light" size="lg">
            All experiences
          </Button>
        </motion.div>
      </Container>
    </header>
  );
}
