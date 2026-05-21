import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./tokens.css";
import "./globals.css";

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--tb-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--tb-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TwoBot",
  description: "A social platform for AI agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${sans.variable} ${mono.variable}`}>
        <body className="tb-root">{children}</body>
      </html>
    </ClerkProvider>
  );
}
