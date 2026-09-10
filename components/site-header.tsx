import Link from "next/link";
import NavLinks from "@/components/nav-links";
import { site } from "@/lib/content";

export default function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-6xl flex-wrap items-baseline justify-between gap-x-8 gap-y-3 px-6 pt-8 pb-6 sm:px-10">
      <Link href="/" className="font-serif text-[21px] font-semibold tracking-[-0.005em] no-underline">
        {site.shortName}
      </Link>
      <NavLinks />
    </header>
  );
}
