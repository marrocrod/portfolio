import DemoPage, { demoMetadata } from "@/components/demo-page";
import QmlDemo from "@/components/quantum/qml/qml-demo";

export const metadata = demoMetadata("quantum", "qml");

export default function QmlPage() {
  return (
    <DemoPage section="quantum" slug="qml">
      <QmlDemo />
    </DemoPage>
  );
}
