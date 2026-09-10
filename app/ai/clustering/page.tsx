import DemoPage, { demoMetadata } from "@/components/demo-page";

export const metadata = demoMetadata("ai", "clustering");

export default function ClusteringPage() {
  // Replace the placeholder by passing the interactive demo as children.
  return <DemoPage section="ai" slug="clustering" />;
}
