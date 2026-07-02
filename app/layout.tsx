import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live Support",
  description: "Live customer support with video, audio, chat, and screen share.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
