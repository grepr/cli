import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Specification - Grepr Docs",
  description: "Grepr API specification and documentation",
};

export default function ApiSpecLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
      }}
    >
      <div style={{ flex: 1, overflow: "hidden" }}>{children}</div>
    </div>
  );
}
