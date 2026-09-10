"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { sectionOrder, sections } from "@/lib/content";

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections">
      <ul className="flex gap-6 text-[15px]">
        {sectionOrder.map((id) => {
          const href = `/${id}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={id}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "text-ink underline decoration-accent decoration-2 underline-offset-[6px]"
                    : "text-ink-muted hover:text-ink"
                }
              >
                {sections[id].title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
