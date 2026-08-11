import { TranscribeSegment, UploadedImage } from "../types";

export interface MediaItem {
  url: string;
  type?: "image" | "video";
  name?: string;
}

/**
 * Distributes M media items across N timeline segments.
 * 1. The first M segments get the M media items in exact sequential order (0 to M-1).
 * 2. If N > M (there are more segments than media items), the remaining segments (M to N-1)
 *    are populated by shuffling/cycling the available M media items so EVERY segment
 *    gets an image and no segment is left empty.
 */
export function distributeMediaToSegments(
  mediaItems: MediaItem[],
  segments: TranscribeSegment[]
): TranscribeSegment[] {
  if (segments.length === 0 || mediaItems.length === 0) {
    return segments;
  }

  const m = mediaItems.length;
  const n = segments.length;

  // Naturally sort media items by name if names exist (e.g. 1.jpg, 2.jpg ... 14.jpg)
  const sortedMedia = [...mediaItems].sort((a, b) => {
    if (a.name && b.name) {
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    }
    return 0;
  });

  const updatedSegments = [...segments];

  // 1. Assign first M segments sequentially line by line
  for (let i = 0; i < Math.min(m, n); i++) {
    const item = sortedMedia[i];
    updatedSegments[i] = {
      ...updatedSegments[i],
      imageUrl: item.url,
      imageType: item.type || "image"
    };
  }

  // 2. For remaining segments (from m to n-1), shuffle/cycle the m media items
  if (n > m) {
    let pool: number[] = [];

    const createShuffledPool = (lastIndex: number): number[] => {
      const arr = Array.from({ length: m }, (_, idx) => idx);
      // Fisher-Yates shuffle
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      // Prevent consecutive identical image if m > 1
      if (m > 1 && arr[0] === lastIndex) {
        [arr[0], arr[arr.length - 1]] = [arr[arr.length - 1], arr[0]];
      }
      return arr;
    };

    let lastPickedIdx = m - 1;

    for (let i = m; i < n; i++) {
      if (pool.length === 0) {
        pool = createShuffledPool(lastPickedIdx);
      }
      const pickIdx = pool.shift()!;
      lastPickedIdx = pickIdx;

      const item = sortedMedia[pickIdx];
      updatedSegments[i] = {
        ...updatedSegments[i],
        imageUrl: item.url,
        imageType: item.type || "image"
      };
    }
  }

  return updatedSegments;
}
