// Keep original fragments; rows are display groups, not semantic conversation turns.
export function createCaptions(gapMs = 1000) {
  const rows = [];
  const seen = new Set();
  let sequence = 0;
  return event => {
    const role = event.type === "session.input_transcript.delta" ? "you"
      : event.type === "session.output_transcript.delta" ? "eff-off" : null;
    if (!role || typeof event.delta !== "string" || !Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms)) return rows;
    if (event.event_id && seen.has(event.event_id)) return rows;
    if (event.event_id) seen.add(event.event_id);
    let row = rows.find(candidate => candidate.role === role &&
      event.start_ms <= candidate.end + gapMs && event.end_ms >= candidate.start - gapMs);
    if (!row) {
      row = { id: `caption-${sequence++}`, role, start: event.start_ms, end: event.end_ms, fragments: [] };
      rows.push(row);
    }
    row.fragments.push({ delta: event.delta, start_ms: event.start_ms, end_ms: event.end_ms });
    row.fragments.sort((a, b) => a.start_ms - b.start_ms);
    row.start = Math.min(row.start, event.start_ms);
    row.end = Math.max(row.end, event.end_ms);
    // A late fragment can bridge two previously separate groups. Keep the
    // earliest displayed row's identity and position when merging them.
    for (let index = 0; index < rows.length; index++) {
      const other = rows[index];
      if (other === row || other.role !== role || other.start > row.end + gapMs || other.end < row.start - gapMs) continue;
      const keep = rows.indexOf(row) < index ? row : other;
      const remove = keep === row ? other : row;
      keep.fragments.push(...remove.fragments);
      keep.start = Math.min(keep.start, remove.start);
      keep.end = Math.max(keep.end, remove.end);
      rows.splice(rows.indexOf(remove), 1);
      row = keep;
      index = -1;
    }
    row.fragments.sort((a, b) => a.start_ms - b.start_ms);
    row.text = row.fragments.map(fragment => fragment.delta).join("");
    return rows.map(value => ({ ...value, fragments: [...value.fragments] }));
  };
}
