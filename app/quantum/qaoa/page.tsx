import DemoPage, { demoMetadata } from "@/components/demo-page";

export const metadata = demoMetadata("quantum", "qaoa");

export default function QaoaPage() {
  // Replace the placeholder by passing the interactive demo as children.
  return <DemoPage section="quantum" slug="qaoa" />;
}
