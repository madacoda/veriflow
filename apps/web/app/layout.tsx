import type { Metadata } from "next";
import type { ReactNode } from "react";
import styles from "../features/workbench/workbench.module.css";

export const metadata: Metadata = {
  title: "Veriflow",
  description: "AI-powered UAT and QA automation",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={styles.body}>{children}</body>
    </html>
  );
}
