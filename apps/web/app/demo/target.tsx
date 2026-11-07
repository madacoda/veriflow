"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  Input,
} from "../../features/ui/primitives";
import styles from "../../features/workbench/workbench.module.css";

export function DemoTarget({ buggy }: { buggy: boolean }) {
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState(false);
  const [message, setMessage] = useState("");

  function applyCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const valid = coupon === "SAVE10";
    setApplied(valid);
    setMessage(
      valid ? "Coupon applied." : "Enter SAVE10 to apply the demo discount.",
    );
  }

  return (
    <main className={styles.surface}>
      <div className={styles.demo}>
        <Link href="/">Back to workbench</Link>
        <h1>Checkout demo</h1>
        <p>Apply SAVE10 to the order and check the total.</p>
        <Card>
          <CardHeader>
            <h2>Order summary</h2>
            <p>{buggy ? "Known-fail target" : "Known-pass target"}</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={applyCoupon} className={styles.form}>
              <label className={styles.field}>
                Coupon code
                <Input
                  data-testid="coupon-input"
                  value={coupon}
                  onChange={(event) => setCoupon(event.currentTarget.value)}
                />
              </label>
              <div className={styles.actions}>
                <button data-testid="apply-coupon" type="submit">
                  Apply coupon
                </button>
                <p role="status" data-testid="validation-error">
                  {message}
                </p>
              </div>
              <dl className={styles.total}>
                <dt>Order total</dt>
                <dd data-testid="order-total">
                  {applied && !buggy ? "90000" : "100000"}
                </dd>
              </dl>
            </form>
          </CardContent>
        </Card>
        <p>
          <Link href={buggy ? "/demo?bug=0" : "/demo?bug=1"}>
            Open {buggy ? "known-pass" : "known-fail"} target
          </Link>
        </p>
      </div>
    </main>
  );
}
