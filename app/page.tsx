import LandscapeFigure from "@/components/landscape-figure";
import SectionBlock from "@/components/section-block";
import { sectionOrder, sections, site } from "@/lib/content";

export default function Home() {
  const links = site.links.filter((l) => l.href);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 sm:px-10">
      <section className="grid items-start gap-x-14 gap-y-12 pt-10 pb-24 lg:grid-cols-12 lg:pt-16">
        <div className="lg:col-span-5 lg:pt-6">
          <h1 className="font-serif text-[48px] font-medium leading-[1.02] tracking-[-0.02em] sm:text-[72px]">
            {site.name}
          </h1>
          <p className="mt-6 font-sans text-[18px] text-ink">
            {site.role}, {site.location}
          </p>
          <p className="mt-6 max-w-[44ch] font-serif text-[19px] leading-[1.6] text-ink-muted">{site.statement}</p>
          {links.length > 0 && (
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[16px]">
              {links.map((l) => (
                <li key={l.label}>
                  <a href={l.href} className="text-link">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="lg:col-span-7">
          <LandscapeFigure />
        </div>
      </section>

      <div className="space-y-24">
        {sectionOrder.map((id) => (
          <SectionBlock key={id} section={sections[id]} />
        ))}
      </div>
    </div>
  );
}
