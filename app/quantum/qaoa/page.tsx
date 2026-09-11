import DemoPage, { demoMetadata } from "@/components/demo-page";
import QaoaDemo from "@/components/quantum/qaoa/qaoa-demo";

export const metadata = demoMetadata("quantum", "qaoa");

export default function QaoaPage() {
  return (
    <DemoPage section="quantum" slug="qaoa">
      <QaoaDemo />
    </DemoPage>
  );
}
