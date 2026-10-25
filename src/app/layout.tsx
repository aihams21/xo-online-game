import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XO Online — ألعاب أونلاين",
  description: "العب إكس أو وأربعة في صف أونلاين مع أصدقائك من أي مكان في العالم",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
