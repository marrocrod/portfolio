import type { Metadata } from "next";
import SectionBlock from "@/components/section-block";
import { sections } from "@/lib/content";

export const metadata: Metadata = {
  title: sections.ai.title,
  description: sections.ai.intro,
};

export default function AiIndex() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 pt-10 sm:px-10 lg:pt-16">
      <SectionBlock section={sections.ai} headingLevel="h1" />
    </div>
  );
}
