import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/overlay";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "PeakShift — make flexibility valuable",
  description: "AI-coordinated demand flexibility with verified PayPal incentive payouts.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#080c0a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} data-theme="control">
      <body>
        <ToastProvider>{children}</ToastProvider>
        <div id="ps-portal" />
      </body>
    </html>
  );
}
