import { ButtonLink } from '../../../components/ButtonLink';
import { CTASection } from '../components/CTASection';
import { FAQAccordion } from '../components/FAQAccordion';
import { Hero } from '../components/Hero';
import { useQuery } from '@tanstack/react-query';
import { getFaqsCmsPublic } from '@/lib/cms';
import { FAQS } from '../content';
import styles from './FaqsPage.module.css';

/** Public FAQs page - CMS-driven with static fallback (Q6). */
export function FaqsPage() {
  const { data: cms } = useQuery({
    queryKey: ['cms', 'faqs'],
    queryFn: getFaqsCmsPublic,
    staleTime: 0,
  });
  const content = (cms ?? FAQS) as typeof FAQS;
  return (
    <div className={styles.page}>
      <Hero
        variant="page"
        eyebrow={content.hero.eyebrow}
        title={content.title}
        lead={content.hero.lead}
        primaryCta={content.hero.primaryCta}
        image={content.hero.image}
      />

      <section className={styles.section}>
        <div className={`container ${styles.grid}`}>
          <div className={styles.rail}>
            <span className={styles.mark} aria-hidden="true">
              ?
            </span>
            <p className={styles.eyebrow}>{content.intro.eyebrow}</p>
            <h2 className={styles.statement}>{content.intro.statement}</h2>
            <p className={`${styles.introBody} prose`}>{content.intro.body}</p>
            <ButtonLink to="/contact" variant="ghost">
              Ask us directly
            </ButtonLink>
          </div>
          <div className={styles.accordionWrap}>
            <FAQAccordion items={content.items} />
          </div>
        </div>
      </section>

      <CTASection
        title={content.cta.title}
        lead={content.cta.lead}
        primaryCta={content.cta.primaryCta}
        secondaryCta={content.cta.secondaryCta}
      />
    </div>
  );
}
