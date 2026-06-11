import type { Metadata } from "next";
import "./globals.css";
import "@xyflow/react/dist/style.css";

export const metadata: Metadata = {
  title: "Browse UI",
  description: "Standalone Browse Canvas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark h-full">
      <body className="h-full flex flex-col bg-background text-foreground antialiased font-mono">
        <main className="flex-1 overflow-y-auto flex flex-col min-h-0 p-6">
          {children}
        </main>
      </body>
    </html>
  );
}
