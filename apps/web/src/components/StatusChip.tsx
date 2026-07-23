export function StatusChip({
  tone,
  children,
}: {
  tone: "good" | "warn" | "danger" | "neutral";
  children: React.ReactNode;
}) {
  return <span className={`status-chip status-${tone}`}>{children}</span>;
}
