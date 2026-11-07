import { DemoTarget } from "./target";

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ bug?: string | string[] }>;
}) {
  const { bug } = await searchParams;
  const buggy = bug !== "0";
  return <DemoTarget key={String(buggy)} buggy={buggy} />;
}
