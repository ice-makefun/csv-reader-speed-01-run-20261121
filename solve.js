// A faster drop-in for csv-reader 1.0.0: run(input) returns exactly the answer
// csv-reader 1.0.0 returns for {text, header}, the JSON value
// {columns, rows, errors}, but reads the text by jumping between delimiters
// with indexOf and slicing whole fields, instead of one character at a time.
//
// The broken-row policy is the reference's, kept exactly:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it one quote, and each CRLF or lone CR inside it is read as LF;
//     what follows its closing quote, up to the next comma or line break, is
//     appended to it as it stands (quote_junk, when the field ends); a quote that
//     never closes is a literal character, and the text after it is read again as
//     an unquoted field (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header is false), each padded with ""
//     (short_row, with fields: its count) or cut (long_row, with extra: the cut
//     fields) to the first record's width;
//   - each error is {code, line, row}, in the order met; a record's short_row or
//     long_row when the record ends: line the 1-based line its record starts on
//     (every LF, CRLF and lone CR inside a quoted field counted), row its record's
//     index in rows (null for the header).
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const N = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended, and how many characters its last unquoted
  // read kept (both set by readUnquoted / readQuoted, read by their callers).
  let ended = END;
  let added = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Sets `ended` and `added`,
  // returns the field value, and advances pos and line.
  function readUnquoted(value) {
    let comma = text.indexOf(',', pos);
    if (comma === -1) comma = N;
    let nl = text.indexOf('\n', pos);
    if (nl === -1) nl = N;
    let end;
    if (comma < nl) {
      end = comma;
      ended = COMMA;
    } else if (nl < N) {
      end = nl;
      ended = LINE_BREAK;
    } else {
      end = N;
      ended = END;
    }
    // A CR just before the LF belongs to the line break, not to the field.
    let fieldEnd = end;
    if (ended === LINE_BREAK && end > pos && text.charCodeAt(end - 1) === 13) fieldEnd = end - 1;
    const v = text.slice(pos, fieldEnd);
    if (v.indexOf('\r') === -1) {
      added = v.length;
      pos = ended === END ? N : end + 1;
      if (ended === LINE_BREAK) line += 1;
      // A fresh field keeps the slice itself; a junk read keeps it appended.
      return value === '' ? v : value + v;
    }
    // Stray CRs: drop each, one error apiece, in the order met; keep the rest.
    let out = value;
    let from = 0;
    for (let i = 0; i < v.length; i++) {
      if (v.charCodeAt(i) === 13) {
        out += v.slice(from, i);
        from = i + 1;
        error('stray_cr');
      }
    }
    out += v.slice(from);
    added = out.length - value.length;
    pos = ended === END ? N : end + 1;
    if (ended === LINE_BREAK) line += 1;
    return out;
  }

  // Appends text[start..end) to `value`, reading each CRLF or lone CR inside it
  // as one LF and counting the lines. The segment holds no quote.
  function appendSegment(value, start, end) {
    const seg = text.slice(start, end);
    if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) return value + seg;
    let out = value;
    let from = start;
    for (let i = start; i < end; i++) {
      const ch = text.charCodeAt(i);
      if (ch === 13) {
        out += text.slice(from, i) + '\n';
        line += 1;
        if (text.charCodeAt(i + 1) === 10) i += 1;
        from = i + 1;
      } else if (ch === 10) {
        out += text.slice(from, i) + '\n';
        line += 1;
        from = i + 1;
      }
    }
    out += text.slice(from, end);
    return out;
  }

  // Reads a quoted field whose opening quote is at pos. Sets `ended`, returns
  // the field value, and advances pos and line.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let q = pos + 1; // the next character to scan for a quote
    let segStart = q; // the start of the segment being read
    let closeQ = -1;
    while (true) {
      const nq = text.indexOf('"', q);
      if (nq === -1) break; // no closing quote
      if (text.charCodeAt(nq + 1) === 34) {
        // A doubled quote: the segment before it is literal, then one quote.
        value = appendSegment(value, segStart, nq);
        value += '"';
        q = nq + 2;
        segStart = q;
        continue;
      }
      closeQ = nq; // the closing quote
      break;
    }
    if (closeQ === -1) {
      // The quote never closes: it is a literal character, and the text after it
      // is read again as an unquoted field.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }
    value = appendSegment(value, segStart, closeQ);
    const after = closeQ + 1;
    if (after >= N) {
      pos = N;
      ended = END;
      return value;
    }
    const c = text.charCodeAt(after);
    if (c === 44) {
      pos = after + 1;
      ended = COMMA;
      return value;
    }
    if (c === 10) {
      pos = after + 1;
      line += 1;
      ended = LINE_BREAK;
      return value;
    }
    if (c === 13 && text.charCodeAt(after + 1) === 10) {
      pos = after + 2;
      line += 1;
      ended = LINE_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    pos = after;
    const junk = readUnquoted(value);
    if (added > 0) error('quote_junk');
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < N) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= N) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
