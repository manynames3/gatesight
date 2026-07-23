export function SystemPage() {
  return (
    <div className="page">
      <header className="page-header">
        <div><p className="eyebrow">OPERATIONS</p><h1>System health</h1><p>Queue, worker, outbox, and station heartbeat signals are available in the CloudWatch operational dashboard.</p></div>
      </header>
      <section className="empty-state">
        <span aria-hidden="true">↗</span>
        <h2>Protected operational telemetry</h2>
        <p>Administrators can use the health and DLQ API endpoints or the AWS CloudWatch dashboard. Plate values are never emitted as metrics or logs.</p>
      </section>
    </div>
  );
}
