import type { ComponentProps } from "react";
import styles from "./primitives.module.css";

// shadcn/ui New York Card and Input, adapted to CSS modules.
export function Card(props: ComponentProps<"div">) {
  return <div data-slot="card" className={styles.card} {...props} />;
}

export function CardHeader(props: ComponentProps<"div">) {
  return <div data-slot="card-header" className={styles.header} {...props} />;
}

export function CardContent(props: ComponentProps<"div">) {
  return <div data-slot="card-content" className={styles.content} {...props} />;
}

export function Input(props: ComponentProps<"input">) {
  return <input data-slot="input" className={styles.input} {...props} />;
}
