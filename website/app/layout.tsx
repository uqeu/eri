import type { Metadata } from "next";
import { Fraunces, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "eri — Talk to your IDE",
  description:
    "eri is the voice-first AI IDE. Say what you want, watch it build, ship to Vercel in under 4 seconds.",
  openGraph: {
    title: "eri — Talk to your IDE",
    description:
      "The voice-first AI IDE. Say what you want, watch it build, ship to Vercel in under 4 seconds.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${fraunces.variable} ${grotesk.variable} ${mono.variable}`}>
      <body className="font-sans bg-ink text-paper min-h-screen">
        {children}
      </body>
    </html>
  );
}
