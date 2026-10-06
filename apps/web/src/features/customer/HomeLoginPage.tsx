import { Seo } from '../../marketing/lib/seo';
import { BrandIntro } from '../../marketing/components/home/BrandIntro';
import { Ecosystem } from '../../marketing/components/home/Ecosystem';
import { SmartWellnessSection } from '../../marketing/components/home/SmartWellnessSection';
import { ALMSection } from '../../marketing/components/home/ALMSection';
import { HotspringSection } from '../../marketing/components/home/HotspringSection';
import { DevelopmentJourney } from '../../marketing/components/home/DevelopmentJourney';
import { VipTeaser } from '../../marketing/components/home/VipTeaser';
import { WhyAfhomes } from '../../marketing/components/home/WhyAfhomes';
import { CtaBanner } from '../../marketing/components/home/CtaBanner';
import { Hero } from '../../marketing/components/home/Hero';

/**
 * The root URL: the pure AF Homes marketing homepage. Member sign-in lives
 * behind the navbar Login entry (`/customer/login`, which keeps the
 * hero + login split) — the landing hero itself carries no form.
 */
export function HomeLoginPage() {
  return (
    <>
      <Seo title="AFhomes — Amazing & Fun. Your Home Away From Home." path="/" />
      <Hero />
      <BrandIntro />
      <Ecosystem />
      <SmartWellnessSection />
      <ALMSection />
      <HotspringSection />
      <DevelopmentJourney />
      <VipTeaser />
      <WhyAfhomes />
      <CtaBanner />
    </>
  );
}
