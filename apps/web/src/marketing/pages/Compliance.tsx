import { Container } from "../components/ui/Container";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionHeading } from "../components/ui/SectionHeading";
import { Reveal } from "../components/ui/Reveal";
import { PlaceholderNotice } from "../components/ui/PlaceholderNotice";
import { Button } from "../components/ui/Button";
import { Seo } from "../lib/seo";
import { cmsRepository } from "../lib/cms";

export default function Compliance() {
  const siteConfig = cmsRepository.getSiteConfig();
  const content = cmsRepository.getPageContent().compliance;
  return (
    <>
      <Seo
        title="Compliance & Transparency"
        description="AFHOMES is a hospitality and resort developer and operator. Compliance, licensing, and corporate transparency information — published as official documentation becomes available."
        path="/compliance"
      />

      <PageHeader
        eyebrow={content.eyebrow}
        title={content.title}
        lede={content.lede}
      />

      {/* Intro + important notices */}
      <section className="bg-cream-100 py-24 sm:py-28" aria-labelledby="compliance-intro-heading">
        <Container>
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-7">
              <SectionHeading
                id="compliance-intro-heading"
                eyebrow="Our Commitment"
                title={content.commitmentTitle}
                lede={content.commitmentLede}
              />

              <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Reveal>
                  <div className="h-full rounded-2xl border border-coral-500/30 bg-coral-100/40 p-7">
                    <p className="label-caps text-coral-700">Not an investment</p>
                    <p className="mt-3 text-sm leading-relaxed text-ink-700">
                      {content.notInvestment}
                    </p>
                  </div>
                </Reveal>
                <Reveal delay={0.08}>
                  <div className="h-full rounded-2xl border border-gold-500/30 bg-gold-100/50 p-7">
                    <p className="label-caps text-[#8a6510]">Verified payments only</p>
                    <p className="mt-3 text-sm leading-relaxed text-ink-700">
                      {content.verifiedPayments}
                    </p>
                  </div>
                </Reveal>
              </div>
            </div>

            <div className="lg:col-span-5">
              <Reveal delay={0.12} y={30}>
                <div className="rounded-[1.25rem] border border-line bg-cream-50 p-8 shadow-soft">
                  <p className="label-caps text-ink-400">Registered entities</p>
                  <ul className="mt-5 space-y-6">
                    {siteConfig.offices.map((office) => (
                      <li key={office.name}>
                        <p className="font-display text-xl font-medium text-navy-900">
                          {office.name}
                        </p>
                        <p className="label-caps mt-1 text-ink-400">{office.role}</p>
                        <p className="mt-2 text-sm leading-relaxed text-ink-600">
                          {office.lines.join(", ")}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>
          </div>
        </Container>
      </section>

      {/* Documentation placeholders */}
      <section className="bg-cream-200/70 py-24 sm:py-28">
        <Container>
          <SectionHeading
            eyebrow="Documentation"
            title="Official records, published as they become available."
            lede="We intentionally do not display certificates, permits, or approvals that have not been officially provided. This page will be updated as documentation is confirmed."
          />

          <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Reveal>
              <div className="group relative h-full">
                <span className="font-display pointer-events-none absolute -top-8 right-0 text-[4.5rem] leading-none font-medium text-navy-900/8 select-none" aria-hidden="true">
                  01
                </span>
                <PlaceholderNotice title="Licenses &amp; Permits">
                  Current business licenses and operating permits for our properties will be
                  published here once the official documents are available for public
                  reference.
                </PlaceholderNotice>
              </div>
            </Reveal>
            <Reveal delay={0.06}>
              <div className="group relative h-full">
                <span className="font-display pointer-events-none absolute -top-8 right-0 text-[4.5rem] leading-none font-medium text-navy-900/8 select-none" aria-hidden="true">
                  02
                </span>
                <PlaceholderNotice title="Government &amp; Regulatory">
                  Information relating to applicable government registrations and regulatory
                  relations — including any LTS / DHSUD-related documentation — will be added
                  here as official documents are provided.
                </PlaceholderNotice>
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <div className="group relative h-full lg:col-span-2">
                <span className="font-display pointer-events-none absolute -top-8 right-0 text-[4.5rem] leading-none font-medium text-navy-900/8 select-none" aria-hidden="true">
                  03
                </span>
                <PlaceholderNotice
                  title="Certifications &amp; Accreditations"
                  className="lg:col-span-2"
                >
                  If and when AFhomes receives official certifications or accreditations, the
                  supporting documents and their issuing authorities will be listed here. We do
                  not list certifications that have not been issued.
                </PlaceholderNotice>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* Privacy + Terms */}
      <section className="bg-cream-100 py-24 sm:py-28" aria-labelledby="policies-heading">
        <Container>
          <SectionHeading
            id="policies-heading"
            eyebrow="Policies"
            title="Privacy & Terms"
          />

          <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Reveal>
              <div id="privacy" className="h-full rounded-[1.25rem] border border-line bg-cream-50 p-8 shadow-soft sm:p-10">
                <h2 className="font-display text-3xl font-medium text-navy-900">Privacy</h2>
                <p className="mt-4 leading-relaxed text-ink-600">
                  {content.privacy}
                </p>
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <div id="terms" className="h-full rounded-[1.25rem] border border-line bg-cream-50 p-8 shadow-soft sm:p-10">
                <h2 className="font-display text-3xl font-medium text-navy-900">Terms</h2>
                <p className="mt-4 leading-relaxed text-ink-600">
                  {content.terms}
                </p>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* Contact for compliance */}
      <section className="bg-navy-950 py-20 text-cream-50">
        <Container>
          <div className="flex flex-col items-start justify-between gap-8 rounded-[1.25rem] border border-white/10 bg-navy-900/60 p-10 sm:p-14 lg:flex-row lg:items-center">
            <div>
              <h2 className="font-display text-4xl leading-tight font-medium text-balance sm:text-5xl">
                Questions about compliance?
              </h2>
              <p className="mt-4 max-w-xl text-lg text-cream-200/75">
                For compliance-related inquiries, please reach out through our contact page
                and the relevant team will respond.
              </p>
            </div>
            <Button to="/contact" variant="accent" size="lg" withArrow>
              Contact us
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
