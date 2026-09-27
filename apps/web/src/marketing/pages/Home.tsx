import { Seo } from "../lib/seo";
import { Hero } from "../components/home/Hero";
import { BrandIntro } from "../components/home/BrandIntro";
import { Ecosystem } from "../components/home/Ecosystem";
import { SmartWellnessSection } from "../components/home/SmartWellnessSection";
import { ALMSection } from "../components/home/ALMSection";
import { HotspringSection } from "../components/home/HotspringSection";
import { DevelopmentJourney } from "../components/home/DevelopmentJourney";
import { VipTeaser } from "../components/home/VipTeaser";
import { WhyAfhomes } from "../components/home/WhyAfhomes";
import { CtaBanner } from "../components/home/CtaBanner";

export default function Home() {
  return (
    <>
      <Seo
        title="AFhomes — Amazing & Fun. Your Home Away From Home."
        path="/"
      />
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