import type { Metadata } from "next";
import { Geist_Mono, Nunito_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const sans = Nunito_Sans({ variable: "--font-sans-brand", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Team Coach",
  description: "An AI coach for a triathlon training group: backend-computed metrics, evidence-backed plan proposals, human decisions.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col bg-background">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
