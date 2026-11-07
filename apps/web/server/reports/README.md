# CSV report renderer

`renderCsv(snapshot)` consumes the same `ReportSnapshot` used by the report adapter. It returns UTF-8 CSV bytes, a media type, and a filename without performing I/O. A `record_type` column distinguishes run, step, event, evidence, capture warning, finding, and AI summary rows. Every row includes the pinned workflow revision, run lifecycle, outcome, adapter, and evidence capture status. Evidence rows contain registered IDs and media types. Formula-like text is escaped for spreadsheet applications.

Dev 1 can dispatch `csv` requests to `renderCsv` when composing the shared `ReportRenderer`. XLSX and PDF remain separate renderer work. Use the `reports-csv` unit test to verify reconciliation against the shared report fixture.
