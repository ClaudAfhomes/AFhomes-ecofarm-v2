import { useParams } from "react-router";
import { Container } from "../components/ui/Container";
import { Button } from "../components/ui/Button";
import { StatusBadge } from "../components/ui/Badge";
import { SmartImage } from "../components/ui/SmartImage";
import { Seo } from "../lib/seo";
import { cmsRepository } from "../lib/cms";

export default function ExperienceDetail() {
  const { slug } = useParams<{ slug: string }>();
  const experience = cmsRepository.getExperiences().find((item) => item.slug === slug);

  if (!experience) {
    return <Container className="py-32 text-center"><p className="font-display text-5xl font-medium text-navy-900">Experience not found</p><Button to="/experiences" variant="primary" size="md" withArrow className="mt-8">Back to Experiences</Button></Container>;
  }

  return <><Seo title={experience.name} description={experience.summary} path={`/experiences/${experience.slug}`} /><header className="relative flex min-h-[72svh] items-end overflow-hidden bg-navy-950 text-cream-50"><div className="absolute inset-0"><SmartImage spec={experience.image} priority className="h-full w-full object-cover opacity-60" sizes="100vw" /><div className="absolute inset-0 bg-gradient-to-t from-navy-950 via-navy-950/55 to-transparent" /></div><Container className="relative pb-16 pt-40 sm:pb-24"><StatusBadge status={experience.status} label={experience.statusLabel} className="border-white/20 bg-white/10 text-cream-100" /><p className="label-caps mt-6 text-cream-200/80">{experience.location}</p><h1 className="font-display mt-4 max-w-4xl text-5xl leading-tight font-medium text-balance sm:text-7xl">{experience.name}</h1><p className="font-display mt-5 max-w-2xl text-2xl text-cream-200/90 italic sm:text-3xl">{experience.headline}</p></Container></header><section className="bg-cream-100 py-20 sm:py-28"><Container size="narrow"><p className="text-xl leading-relaxed text-ink-700 sm:text-2xl">{experience.description}</p><div className="mt-10 grid gap-4 sm:grid-cols-2"><div className="rounded-2xl border border-line bg-cream-50 p-7"><p className="label-caps text-ink-400">Highlights</p><ul className="mt-5 space-y-3">{experience.highlights.map((highlight) => <li key={highlight} className="flex gap-3 text-ink-700"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-leaf-500" />{highlight}</li>)}</ul></div><div className="rounded-2xl border border-line bg-cream-50 p-7"><p className="label-caps text-ink-400">Next step</p><p className="mt-4 text-lg leading-relaxed text-ink-700">{experience.summary}</p><Button to="/contact" variant="accent" size="md" withArrow className="mt-7">Enquire with AFhomes</Button></div></div></Container></section></>;
}
