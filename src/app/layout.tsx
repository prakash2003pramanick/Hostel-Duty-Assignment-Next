import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hostel Duty Assignment System",
  description: "Hostel Duty Allotment - KIIT",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
