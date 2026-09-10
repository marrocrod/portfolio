import DemoPage, { demoMetadata } from "@/components/demo-page";

export const metadata = demoMetadata("quantum", "qml");

export default function QmlPage() {
  // Replace the placeholder by passing the interactive demo as children.
  return <DemoPage section="quantum" slug="qml" />;
}
