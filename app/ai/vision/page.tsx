import DemoPage, { demoMetadata } from "@/components/demo-page";

export const metadata = demoMetadata("ai", "vision");

export default function VisionPage() {
  // Replace the placeholder by passing the interactive demo as children.
  return <DemoPage section="ai" slug="vision" />;
}
