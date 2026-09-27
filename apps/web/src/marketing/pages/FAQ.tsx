import { useState } from "react";
import { Container } from "../components/ui/Container";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionHeading } from "../components/ui/SectionHeading";
import { Accordion } from "../components/ui/Accordion";
import { Reveal } from "../components/ui/Reveal";
import { Button } from "../components/ui/Button";
import { Seo } from "../lib/seo";
import { cmsRepository } from "../lib/cms";
import { cn } from "../lib/cn";

export default function FAQ() {
  const faqCategories = cmsRepository.getFaqCategories();
  const content = cmsRepository.getPageContent().faq;
  const [active, setActive] = useState(faqCategories[0]?.id ?? "");

  return (
    <>
      <Seo
        title="FAQ — Frequently Asked Questions"
        description="Answers to common questions about AFhomes, the Smart Wellness Hotel, the Hotspring & Ecofarm Resort, and the VIP Privilege Program."
        path="/faq"
      />

      <PageHeader
        eyebrow={content.eyebrow}
        title={content.title}
        lede={content.lede}
      />

      <section className="bg-cream-100 py-20 sm:py-28">
        <Container>
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
            {/* Category nav */}
            <div className="lg:col-span-4">
              <SectionHeading
                eyebrow="Browse by topic"
                title={content.browseTitle}
              />
              <Reveal delay={0.1}>
                <div
                  className="mt-8 flex flex-wrap gap-2 lg:flex-col lg:gap-1"
                  role="tablist"
                  aria-label="FAQ categories"
                >
                  {faqCategories.map((category) => {
                    const isActive = category.id === active;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        id={`faq-tab-${category.id}`}
                        aria-controls={`faq-panel-${category.id}`}
                        onClick={() => setActive(category.id)}
                        className={cn(
                          "label-caps flex items-center gap-2 rounded-full border px-5 py-3 text-left transition-colors lg:rounded-xl",
                          isActive
                            ? "border-navy-800 bg-navy-800 text-cream-50"
                            : "border-line bg-cream-50 text-ink-600 hover:border-navy-300 hover:text-navy-900",
                        )}
                      >
                        {category.label}
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs",
                            isActive
                              ? "bg-cream-50/15 text-cream-200"
                              : "bg-cream-200/70 text-ink-400",
                          )}
                          aria-hidden="true"
                        >
                          {category.items.length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Reveal>

              <Reveal delay={0.16}>
                <div className="mt-10 rounded-2xl border border-line bg-cream-50 p-6">
                  <p className="label-caps text-ink-400">Still have a question?</p>
                  <p className="mt-3 text-sm leading-relaxed text-ink-600">
                    {content.contactPrompt}
                  </p>
                  <Button to="/contact" variant="text" size="sm" withArrow className="mt-4">
                    {content.stillCuriousButton}
                  </Button>
                </div>
              </Reveal>
            </div>

            {/* Accordion */}
            <div className="lg:col-span-8">
              {faqCategories.map((category) => {
                const isActive = category.id === active;
                return (
                  <div
                    key={category.id}
                    role="tabpanel"
                    id={`faq-panel-${category.id}`}
                    aria-labelledby={`faq-tab-${category.id}`}
                    hidden={!isActive}
                  >
                    <Reveal key={category.id}>
                      <Accordion
                        items={category.items.map((item, index) => ({
                          id: `${category.id}-${index}`,
                          question: item.question,
                          answer: item.answer,
                        }))}
                        allowMultiple={false}
                        tone="light"
                      />
                    </Reveal>
                  </div>
                );
              })}
            </div>
          </div>
        </Container>
      </section>

      {/* Still curious */}
      <section className="bg-navy-950 py-20 text-cream-50">
        <Container>
          <div className="flex flex-col items-start justify-between gap-8 rounded-[1.25rem] border border-white/10 bg-navy-900/60 p-10 sm:p-14 lg:flex-row lg:items-center">
            <div>
              <h2 className="font-display text-4xl leading-tight font-medium text-balance sm:text-5xl">
                {content.stillCuriousTitle}
              </h2>
              <p className="mt-4 max-w-xl text-lg text-cream-200/75">
                {content.stillCuriousLede}
              </p>
            </div>
            <Button to="/contact" variant="accent" size="lg" withArrow>
              {content.stillCuriousButton}
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
