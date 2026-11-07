# CSV report renderer

`renderCsv(snapshot)` consumes the same `ReportSnapshot` used by the report adapter. It returns UTF-8 CSV bytes, a media type, and a filename without performing I/O. A `record_type` column distinguishes run, step, event, evidence, capture warning, finding, and AI summary rows. Every row includes the pinned workflow revision, run lifecycle, outcome, adapter, and evidence capture status. Evidence rows contain registered IDs and media types. Formula-like text is escaped for spreadsheet applications.

Runtime composition dispatches `csv` requests to `renderCsv` through the shared `ReportRenderer`. XLSX and PDF remain separate renderer work and currently reject with 422. Use the `reports-csv` unit test to verify reconciliation against the shared report fixture.

Known correctness gap: `viewport` repeats the initial run viewport on all rows, even when responsive workflow commands change it. [Audit finding D5](../../../../docs/project-audit.md#d5--p2-responsive-csv-rows-report-the-wrong-viewport-context) defines the required distinction between initial and observed per-step viewport. Existing tests do not cover that transition.
