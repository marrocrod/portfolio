import DemoPage, { demoMetadata } from "@/components/demo-page";

export const metadata = demoMetadata("ai", "time-series");

export default function TimeSeriesPage() {
  // Replace the placeholder by passing the interactive demo as children.
  return <DemoPage section="ai" slug="time-series" />;
}
