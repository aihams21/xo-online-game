import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XO Online — لعبة إكس أو أونلاين",
  description: "العب إكس أو أونلاين مع أصدقائك من أي مكان في العالم",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
