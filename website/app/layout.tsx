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
  title: "eri — Local agentic workbench",
  description:
    "eri is a local agentic workbench for code, CLI runs, and cloud handoff. Plan, edit, test, and ship from your machine.",
  openGraph: {
    title: "eri — Local agentic workbench",
    description:
      "A local agentic workbench for code, CLI runs, and cloud handoff. Plan, edit, test, and ship from your machine.",
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
