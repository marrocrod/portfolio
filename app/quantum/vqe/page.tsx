import DemoPage, { demoMetadata } from "@/components/demo-page";

export const metadata = demoMetadata("quantum", "vqe");

export default function VqePage() {
  // Replace the placeholder by passing the interactive demo as children.
  return <DemoPage section="quantum" slug="vqe" />;
}
