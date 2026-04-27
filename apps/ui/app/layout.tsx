import type { Metadata } from "next";
import { inter, jetbrainsMono, spaceGrotesk } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "BeerEngineer",
  description: "BeerEngineer UI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
      data-theme="dark"
    >
      <body className="bg-zinc-950 text-zinc-100 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
