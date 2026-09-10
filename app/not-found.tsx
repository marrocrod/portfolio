import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 pt-16 sm:px-10">
      <h1 className="font-serif text-[48px] font-medium leading-[1.05]">Page not found</h1>
      <p className="mt-6 max-w-[48ch] font-serif text-[19px] leading-[1.6] text-ink-muted">
        This address does not match any page. Go back to the{" "}
        <Link href="/" className="text-link">
          home page
        </Link>{" "}
        to see every demo.
      </p>
    </div>
  );
}
