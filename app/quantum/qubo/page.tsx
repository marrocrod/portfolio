import DemoPage, { demoMetadata } from "@/components/demo-page";

export const metadata = demoMetadata("quantum", "qubo");

export default function QuboPage() {
  // Replace the placeholder by passing the interactive demo as children.
  return <DemoPage section="quantum" slug="qubo" />;
}
