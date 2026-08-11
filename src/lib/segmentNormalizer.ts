import { TranscribeSegment } from "../types";

/**
 * Normalizes transcription segments to ensure chronological order,
 * no negative times, valid numeric timestamps, and accurate synchronization
 * with audio speech without distorting text or timestamps.
 */
export function normalizeSegments(
  rawSegments: TranscribeSegment[],
  audioDuration?: number | null
): TranscribeSegment[] {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) return [];

  // 1. Clean and validate numbers while keeping verbatim text intact
  let cleaned: TranscribeSegment[] = rawSegments
    .map((s) => {
      let start = typeof s.start === "number" ? s.start : parseFloat(String(s.start));
      let end = typeof s.end === "number" ? s.end : parseFloat(String(s.end));
      let text = typeof s.text === "string" ? s.text.trim() : "";
      
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end <= start) end = start + 1.2;

      return {
        ...s,
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
        text
      };
    })
    .filter((s) => s.text.length > 0 || !!s.imageUrl);

  if (cleaned.length === 0) return rawSegments;

  // 2. Sort chronologically by start timestamp
  cleaned.sort((a, b) => a.start - b.start);

  // 3. Fix negative timestamps or invalid end bounds
  const dur = audioDuration && audioDuration > 0 ? audioDuration : null;

  for (let i = 0; i < cleaned.length; i++) {
    cleaned[i].start = Number(Math.max(0, cleaned[i].start).toFixed(3));

    if (cleaned[i].end <= cleaned[i].start) {
      cleaned[i].end = Number((cleaned[i].start + 1.2).toFixed(3));
    }

    if (dur && cleaned[i].end > dur + 0.1) {
      cleaned[i].end = Number(dur.toFixed(3));
    }

    // Resolve overlaps: if segment i end extends beyond segment i+1 start, adjust segment i end
    if (i < cleaned.length - 1 && cleaned[i].end > cleaned[i + 1].start) {
      cleaned[i].end = Number(Math.max(cleaned[i].start + 0.1, cleaned[i + 1].start).toFixed(3));
    }
  }

  return cleaned;
}
