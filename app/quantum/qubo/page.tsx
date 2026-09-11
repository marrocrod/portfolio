import DemoPage, { demoMetadata } from "@/components/demo-page";
import QuboDemo from "@/components/quantum/qubo/qubo-demo";

export const metadata = demoMetadata("quantum", "qubo");

export default function QuboPage() {
  return (
    <DemoPage section="quantum" slug="qubo">
      <QuboDemo />
    </DemoPage>
  );
}
