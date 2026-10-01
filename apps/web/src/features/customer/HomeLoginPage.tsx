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
import { HomeLoginSplit } from './HomeLoginSplit';

/**
 * The root URL: the AF Homes homepage with the member sign-in beside the
 * hero, and every other homepage section below it unchanged.
 *
 * The marketing `Hero` is replaced by the split (same CMS copy, same
 * imagery); all remaining sections render verbatim so marketing assertions
 * keep holding.
 */
export function HomeLoginPage() {
  return (
    <>
      <Seo title="AFhomes — Amazing & Fun. Your Home Away From Home." path="/" />
      <HomeLoginSplit />
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
