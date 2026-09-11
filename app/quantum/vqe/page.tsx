import DemoPage, { demoMetadata } from "@/components/demo-page";
import VqeDemo from "@/components/quantum/vqe/vqe-demo";

export const metadata = demoMetadata("quantum", "vqe");

export default function VqePage() {
  return (
    <DemoPage section="quantum" slug="vqe">
      <VqeDemo />
    </DemoPage>
  );
}
