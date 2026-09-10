import DemoPage, { demoMetadata } from "@/components/demo-page";

export const metadata = demoMetadata("ai", "voice-chat");

export default function VoiceChatPage() {
  // Replace the placeholder by passing the interactive demo as children.
  return <DemoPage section="ai" slug="voice-chat" />;
}
