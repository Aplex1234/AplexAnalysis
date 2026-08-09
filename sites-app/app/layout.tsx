import type { Metadata } from "next";
import "./carbon.scss";
import "./globals.css";

const title = "AplexAnalysis | Equity Research Terminal";
const description =
  "Search SEC-reporting companies and explore revenue, earnings, margins, cash flow, balance sheets and valuation.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://aplexanalysis.aplex-1.chatgpt.site"),
  title,
  description,
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title,
    description,
    type: "website",
    url: "/",
    images: [{ url: "/og-premium.png", width: 1536, height: 1024, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og-premium.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
