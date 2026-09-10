import Link from "next/link";
import { type Section, statusLabel } from "@/lib/content";

interface Props {
  section: Section;
  /** Render the heading as h1 on the section index page, h2 elsewhere. */
  headingLevel?: "h1" | "h2";
}

export default function SectionBlock({ section, headingLevel = "h2" }: Props) {
  const Heading = headingLevel;
  const headingSize = headingLevel === "h1" ? "text-[48px] sm:text-[60px]" : "text-[36px]";

  return (
    <section aria-labelledby={`section-${section.id}`} className="grid gap-x-12 gap-y-6 md:grid-cols-12">
      <div className="md:col-span-4">
        <Heading
          id={`section-${section.id}`}
          className={`font-serif ${headingSize} font-medium leading-[1.05] tracking-[-0.015em]`}
        >
          {headingLevel === "h2" ? (
            <Link href={`/${section.id}`} className="hover:text-accent-strong">
              {section.title}
            </Link>
          ) : (
            section.title
          )}
        </Heading>
        <p className="mt-4 max-w-[38ch] font-serif text-[17px] leading-[1.6] text-ink-muted">{section.intro}</p>
      </div>

      <ul className="md:col-span-8">
        {section.demos.map((demo) => (
          <li key={demo.slug} className="border-t border-rule last:border-b">
            <Link
              href={`/${section.id}/${demo.slug}`}
              className="group grid gap-x-6 gap-y-1 py-5 sm:grid-cols-[1fr_auto]"
            >
              <span className="font-serif text-[24px] leading-[1.2] text-ink group-hover:text-accent-strong group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
                {demo.title}
              </span>
              <span className="order-last text-[14px] text-ink-muted sm:order-none sm:row-span-2 sm:pt-2 sm:text-right">
                {statusLabel[demo.status]}
              </span>
              <span className="max-w-[62ch] text-[16px] leading-[1.55] text-ink-muted">{demo.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
