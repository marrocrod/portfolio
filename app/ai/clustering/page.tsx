import DemoPage, { demoMetadata } from "@/components/demo-page";
import Playground from "@/components/ml-playground/playground";

export const metadata = demoMetadata("ai", "clustering");

export default function ClusteringPage() {
  return (
    <DemoPage section="ai" slug="clustering">
      <Playground />
    </DemoPage>
  );
}
