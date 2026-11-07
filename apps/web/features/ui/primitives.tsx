import type { ComponentProps } from "react";
import {
  Card as RegistryCard,
  CardContent as RegistryCardContent,
  CardHeader as RegistryCardHeader,
} from "./card";
import { Input as RegistryInput } from "./input";
import styles from "./primitives.module.css";
import { cn } from "./utils";

export function Card({
  className,
  ...props
}: ComponentProps<typeof RegistryCard>) {
  return <RegistryCard className={cn(styles.card, className)} {...props} />;
}

export function CardHeader({
  className,
  ...props
}: ComponentProps<typeof RegistryCardHeader>) {
  return (
    <RegistryCardHeader className={cn(styles.header, className)} {...props} />
  );
}

export function CardContent({
  className,
  ...props
}: ComponentProps<typeof RegistryCardContent>) {
  return (
    <RegistryCardContent className={cn(styles.content, className)} {...props} />
  );
}

export function Input({
  className,
  ...props
}: ComponentProps<typeof RegistryInput>) {
  return <RegistryInput className={cn(styles.input, className)} {...props} />;
}
