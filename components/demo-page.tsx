import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getDemo, type SectionId, sections, statusLabel } from "@/lib/content";

export function demoMetadata(section: SectionId, slug: string): Metadata {
  const demo = getDemo(section, slug);
  return { title: demo.title, description: demo.summary };
}

interface Props {
  section: SectionId;
  slug: string;
  /** The interactive demo. When omitted, an in-progress placeholder is shown. */
  children?: ReactNode;
}

export default function DemoPage({ section, slug, children }: Props) {
  const demo = getDemo(section, slug);
  const parent = sections[section];

  return (
    <article className="mx-auto w-full max-w-6xl px-6 pt-10 sm:px-10 lg:pt-14">
      <Link href={`/${section}`} className="text-[15px] text-ink-muted hover:text-ink">
        ← {parent.title}
      </Link>

      <header className="mt-6 max-w-3xl">
        <h1 className="font-serif text-[48px] font-medium leading-[1.05] tracking-[-0.015em] sm:text-[60px]">
          {demo.title}
        </h1>
        <p className="mt-6 max-w-[58ch] font-serif text-[20px] leading-[1.6] text-ink-muted">{demo.summary}</p>
        <p className="mt-4 text-[14px] text-ink-muted">{statusLabel[demo.status]}</p>
      </header>

      <div className="mt-12">
        {children ?? (
          <div className="flex aspect-[16/7] min-h-64 items-center justify-center rounded-[3px] border border-dashed border-rule bg-paper-raised px-6 text-center">
            <p className="max-w-[46ch] font-serif text-[17px] leading-[1.6] text-ink-muted">
              This demo is still being built. Meanwhile, you can explore a live QAOA parameter landscape on
              the{" "}
              <Link href="/" className="text-link">
                home page
              </Link>
              .
            </p>
          </div>
        )}
      </div>

      <div className="mt-16 grid gap-x-12 gap-y-10 md:grid-cols-12">
        <section className="md:col-span-7">
          <h2 className="font-serif text-[24px] font-medium">
            {demo.status === "live" ? "What you can do" : "What you will be able to do"}
          </h2>
          <ul className="mt-4 space-y-3 font-serif text-[17px] leading-[1.6] text-ink-muted">
            {demo.capabilities.map((c) => (
              <li key={c} className="relative pl-5 before:absolute before:left-0 before:top-[0.72em] before:h-[5px] before:w-[5px] before:rounded-full before:bg-accent">
                {c}
              </li>
            ))}
          </ul>
        </section>
        <section className="md:col-span-5">
          <h2 className="font-serif text-[24px] font-medium">Built with</h2>
          <ul className="mt-4 space-y-2 text-[16px] text-ink">
            {demo.stack.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      </div>
    </article>
  );
}
