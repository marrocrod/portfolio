import DemoPage, { demoMetadata } from "@/components/demo-page";
import ObjectDetector from "@/components/vision/object-detector";

export const metadata = demoMetadata("ai", "vision");

export default function VisionPage() {
  return (
    <DemoPage section="ai" slug="vision">
      <ObjectDetector />
    </DemoPage>
  );
}
