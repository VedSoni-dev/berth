import { PublikGate } from "@/components/PublikGate";
import { Console } from "@/components/Console";

// The software opens with Sign in with publik; the landing page at / does not.
export default function AppPage() {
  return (
    <PublikGate appName="berth" tagline="Your phone chats with the AI models running on your Mac." preview="/gate-preview.mp4">
      <Console />
    </PublikGate>
  );
}
