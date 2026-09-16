import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice Production Studio",
  description: "Secure German AI voiceover generation and quality control."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
