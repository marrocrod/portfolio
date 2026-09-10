import { site } from "@/lib/content";

export default function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mx-auto mt-24 w-full max-w-6xl px-6 pb-10 sm:px-10">
      <div className="border-t border-rule pt-6 text-[14px] text-ink-muted">
        © {year} {site.name}. Built with Next.js and deployed on Vercel.
      </div>
    </footer>
  );
}
