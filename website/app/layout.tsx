import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";

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
  title: "eri — Your computer, hands-free",
  description:
    "eri is a local-first AI that runs your computer. It sees your screen, hears you, remembers you, and acts — a coding agent and a computer-use agent in one. Voice and eyes in, action out.",
  openGraph: {
    title: "eri — Your computer, hands-free",
    description:
      "A local-first AI that sees your screen, hears you, remembers you, and does the work. Coding agent + computer-use agent in one.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${grotesk.variable} ${mono.variable}`}>
      <head>
        {/* Funnel Display loaded via Google Fonts link — not in next/font/google allowlist */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Funnel+Display:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans bg-bg text-text min-h-screen">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
