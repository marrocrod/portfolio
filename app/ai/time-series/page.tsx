import DemoPage, { demoMetadata } from "@/components/demo-page";
import ElectricityForecast from "@/components/time-series/electricity-forecast";

export const metadata = demoMetadata("ai", "time-series");

export default function TimeSeriesPage() {
  return (
    <DemoPage section="ai" slug="time-series">
      <ElectricityForecast />
    </DemoPage>
  );
}
