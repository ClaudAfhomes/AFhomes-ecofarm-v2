import { ImageBlock } from '../../../components/ImageBlock';
import { SectionHeader } from '../../../components/SectionHeader';
import { CTASection } from '../components/CTASection';
import { Hero } from '../components/Hero';
import { useQuery } from '@tanstack/react-query';

import { getAboutCms } from '@/lib/cms';
import { ABOUT, photoUrl } from '../content';
import styles from './AboutPage.module.css';

/** Check marker for the approach points (gold, circular). */
const CHECK_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M5.5 12.5l4 4L18.5 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Public About Us page - CMS-driven with static fallback (Q6). */
export function AboutPage() {
  const { data: cms } = useQuery({
    queryKey: ['cms', 'about'],
    queryFn: getAboutCms,
    staleTime: 0,
  });
  // CMS AboutContent has hero.title/lead; static ABOUT has top-level title/lead and hero without title/lead.
  // Normalize so both shapes work without hiding mismatches.
  const raw = (cms as unknown as typeof ABOUT) ?? ABOUT;
  const heroWithTitle = raw.hero as unknown as { title?: string; lead?: string };
  const content = {
    ...raw,
    title: (raw as unknown as { title?: string }).title ?? heroWithTitle.title ?? '',
    lead: (raw as unknown as { lead?: string }).lead ?? heroWithTitle.lead ?? '',
  } as unknown as typeof ABOUT;
  return (
    <div className={styles.page}>
      <Hero
        variant="page"
        eyebrow={content.hero.eyebrow}
        title={content.title}
        lead={content.lead}
        primaryCta={content.hero.primaryCta}
        image={content.hero.image}
      />

      {/* 01 - Who we are */}
      <section className={styles.section}>
        <div className={`container ${styles.introGrid}`}>
          <div className={styles.introMedia}>
            <ImageBlock
              src={photoUrl(content.intro.image.id, 900)}
              alt={content.intro.image.alt}
              ratio="portrait"
              className={styles.introImage}
            />
            <p className={styles.introLabel}>
              <span className={styles.introLabelTitle}>{content.intro.label.title}</span>
              <span className={styles.introLabelBody}>{content.intro.label.body}</span>
            </p>
          </div>
          <div>
            <SectionHeader eyebrow={content.intro.eyebrow} title={content.intro.title} />
            {content.intro.paragraphs.map((paragraph) => (
              <p key={paragraph} className={`${styles.paragraph} prose`}>
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* 02 - The JA&D philosophy */}
      <section className={`${styles.section} ${styles.sectionMuted}`}>
        <div className="container">
          <SectionHeader
            eyebrow={content.philosophy.eyebrow}
            title={content.philosophy.title}
            lead={content.philosophy.lead}
          />
          <ol className={styles.principles}>
            {content.philosophy.items.map((item, index) => (
              <li key={item.title} className={styles.principle}>
                <span className={styles.principleIndex} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className={styles.principleContent}>
                  <h3 className={styles.principleTitle}>{item.title}</h3>
                  <p className={styles.principleBody}>{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 03 - Our approach */}
      <section className={styles.section}>
        <div className={`container ${styles.approachGrid}`}>
          <div>
            <SectionHeader eyebrow={content.approach.eyebrow} title={content.approach.title} />
            <p className={`${styles.paragraph} prose`}>{content.approach.lead}</p>
            <ul className={styles.approachPoints}>
              {content.approach.points.map((point) => (
                <li key={point.title} className={styles.approachPoint}>
                  <span className={styles.approachPointIcon}>{CHECK_ICON}</span>
                  <div>
                    <h3 className={styles.approachPointTitle}>{point.title}</h3>
                    <p className={styles.approachPointBody}>{point.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.approachMedia}>
            <ImageBlock
              src={photoUrl(content.approach.image.id, 900)}
              alt={content.approach.image.alt}
              ratio="portrait"
              className={styles.approachImage}
            />
          </div>
        </div>
      </section>

      {/* 04 - Vision */}
      <section className={`${styles.section} ${styles.sectionMuted}`}>
        <div className="container">
          <div className={styles.vision}>
            <p className={styles.visionEyebrow}>{content.vision.eyebrow}</p>
            <h2 className={styles.visionStatement}>{content.vision.statement}</h2>
          </div>
        </div>
      </section>

      {/* 05 - Mission */}
      <section className={styles.section}>
        <div className="container">
          <SectionHeader
            eyebrow={content.mission.eyebrow}
            title={content.mission.title}
            lead={content.mission.lead}
          />
          <ol className={styles.missionPoints}>
            {content.mission.points.map((point, index) => (
              <li key={point.title} className={styles.missionPoint}>
                <span className={styles.missionIndex} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className={styles.missionTitle}>{point.title}</h3>
                <p className={styles.missionBody}>{point.body}</p>
              </li>
            ))}
          </ol>
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
