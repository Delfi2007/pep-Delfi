import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";

// Inter stands in for SF Pro (not available via next/font); JetBrains Mono
// stands in for SF Mono, used only for artifact IDs and hashes.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ACPIA — Investigation Console",
  description: "Agentic Child Protection Investigation Assistant",
};

/**
 * Applies the saved theme before first paint. This has to be a blocking
 * inline script: doing it in an effect means the browser paints the OS
 * theme first and then snaps to the chosen one, which on a dark-set
 * machine is a white flash on every page load. Kept deliberately tiny,
 * and wrapped in try/catch because localStorage throws outright in some
 * privacy modes.
 */
const THEME_INIT = `(function(){try{var t=localStorage.getItem('acpia-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      // The inline script sets this before React hydrates, so the server
      // markup and the client's first paint necessarily differ here.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-full bg-canvas text-label-primary">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
