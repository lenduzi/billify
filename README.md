# billify
Automatic invoice numbering from uploaded PDFs.

## Quick start
1. Run a local server from the repo root:

```bash
python3 -m http.server 5173
```

2. Open `http://localhost:5173` in your browser.
3. Upload your invoice PDFs and download the renamed ZIP.

## How it works
- Extracts invoice dates from PDF text using PDF.js.
- Sorts invoices by date (default: furthest from today → closest).
- Renames to `Rechnung_01_2026.pdf` style with configurable prefix, start number, padding, and suffix/year.

If a PDF date cannot be found, you can manually fill it in before downloading the ZIP.
