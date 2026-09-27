# Payout vs 1099 Reconciler

**Not tax advice.** This tool only adds up and compares numbers you provide. It does not say which figure to report or file, whether any amount is taxed, or what you owe. For those questions, ask a qualified tax professional.

## What it does
Your platform's earnings summary says one number and your 1099 says another. Drop in your own payout/earnings CSV (and, optionally, a CSV of bank deposits), then type in the amounts printed on your form. You get a plain report:

- MATCH or MISMATCH for each form amount, with the difference (your records minus the form)
- whether a gap is the same size as your tips, fees, tips + fees, or gross minus payout
- tips in your records that weren't checked against a form figure
- unreadable cells and possible duplicate rows
- payouts vs deposits, overall and month by month

The report downloads as .txt or .csv. Click "Try it with sample data" (or open `index.html#demo`) to see it with synthetic numbers.

## Privacy
Everything runs in your browser tab. Your files are never uploaded, stored, or tracked. There are no accounts and no analytics. The page's Content Security Policy (`default-src 'none'; connect-src 'none'`) blocks it from making any network request. You can also download this repo and open `index.html` offline.

## Files
- `index.html`, `app.js`, `reconcile.js`: the tool (plain HTML + JavaScript, no dependencies)
- `sample-data.js`, `samples/SAMPLE_*.csv`: **SAMPLE DATA, synthetic.** Not anyone's real earnings. The column names are made up and don't match any specific platform's export.

## License
MIT. See `LICENSE`.
