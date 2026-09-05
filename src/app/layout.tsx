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
  title: "Arc Merchant - x402 Payments for AI Agents",
  description: "Full end-to-end agentic commerce on Arc. Sell content to AI agents, get paid in USDC via x402. Watch payments land on-chain in real time.",
  icons: {
    icon: "/arc-merchant-logo.png",
    apple: "/arc-merchant-logo.png",
  },
  openGraph: {
    images: ["/arc-merchant-logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
