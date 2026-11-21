[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/ice-makefun/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/ice-makefun/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# csv-reader-speed-01 — a faster drop-in for csv-reader 1.0.0

`run(input)` in `solve.js` returns exactly the answer csv-reader 1.0.0 returns
for `{text, header}` — the JSON value `{columns, rows, errors}` — but reads the
text by jumping between delimiters with `indexOf` and slicing whole fields,
instead of one character at a time.

The broken-row policy is the reference's, kept exactly: a U+FEFF at the very
start is dropped; a record ends at LF or CRLF and a line left with no characters
is no record; outside a quoted field a CR not followed by LF is dropped
(`stray_cr`); a field that opens with a quote runs to the next quote that is
not doubled (`""` inside it one quote, each CRLF or lone CR inside it read as
LF); what follows its closing quote, up to the next comma or line break, is
appended as it stands (`quote_junk`, when the field ends); a quote that never
closes is a literal character, and the text after it is read again as unquoted
(`unterminated_quote`); a quote inside an unquoted field is a literal
character; fields stay strings, never trimmed or converted; `columns` is the
first record when `header` is true, else null; `rows` holds the records after
it (every record when `header` is false), each padded with `""` (`short_row`,
with `fields`: its count) or cut (`long_row`, with `extra`: the cut fields) to
the first record's width; each error is `{code, line, row}`, in the order met.

`main.ts` (Node 22) reads every case from `/input/cases.json`, answers each
one alone with `run`, and writes `/output/answers.json`. It turns V8's
incremental marking off before importing `solve.js`, as the house baseline
does.

## Speed (local, practice set, 10.2 MB CSV)

| | parse-only CPU | full program CPU |
| --- | --- | --- |
| csv-reader 1.0.0 (baseline) | 863 ms | 2.50 s |
| this entry | 208 ms | 1.39 s |

About **4.1× faster** at parsing, **1.8× faster** end to end (the rest is the
JSON read/write both entries share). All 6 practice cases identical to the
reference, and 3,000+ fuzzed broken-CSV cases show 0 differences.

## License

MIT. See [LICENSE](LICENSE).
