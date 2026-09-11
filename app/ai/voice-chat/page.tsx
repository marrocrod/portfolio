import DemoPage, { demoMetadata } from "@/components/demo-page";
import VoiceChat from "@/components/voice/voice-chat";

export const metadata = demoMetadata("ai", "voice-chat");

export default function VoiceChatPage() {
  return (
    <DemoPage section="ai" slug="voice-chat">
      <VoiceChat />
    </DemoPage>
  );
}
