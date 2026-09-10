import type { Metadata } from "next";
import SectionBlock from "@/components/section-block";
import { sections } from "@/lib/content";

export const metadata: Metadata = {
  title: sections.quantum.title,
  description: sections.quantum.intro,
};

export default function QuantumIndex() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 pt-10 sm:px-10 lg:pt-16">
      <SectionBlock section={sections.quantum} headingLevel="h1" />
    </div>
  );
}
