import type { Metadata } from "next";
import { Landing } from "@/components/Landing";

const DESCRIPTION =
  "Run one command on your Mac and chat from your phone with the open-weight models Ollama runs there, over your Wi-Fi. Free and open source.";

// The landing page's own head: its title and description, and the page type the taste kit reads
// (page-type and site-kind; <html data-type> is set by Landing's first script).
export const metadata: Metadata = {
  title: "berth: chat on your phone with the AI models on your Mac",
  description: DESCRIPTION,
  openGraph: {
    title: "berth: your phone chats with AI models on your Mac",
    description: DESCRIPTION,
    type: "website",
  },
  twitter: { card: "summary_large_image" },
  other: { "page-type": "software", "site-kind": "software" },
};

export default function Home() {
  return <Landing />;
}
