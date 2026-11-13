import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "styleprobe — Visual DNA Extractor for AI Coding Agents",
  description:
    "Point at any domain. Extract colors, typography scales, components, and visual rules for AI coding agents in seconds.",
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: "styleprobe — Visual DNA Extractor",
    description:
      "Extract colors, typography scales, components, and visual rules from any website directly into AI-ready Markdown, shadcn/ui variables, and Tailwind configs.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#09090b] text-[#f4f4f5]">
        {children}
      </body>
    </html>
  );
}
