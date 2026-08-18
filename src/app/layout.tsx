import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TimbangQR Harapan Jaya",
  description: "Sistem jembatan timbang dan QR armada LPS",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
