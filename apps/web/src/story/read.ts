const WORDS_PER_SECOND = 4;

/** Seconds to read `text` at 240 words a minute, rounded up to 5. */
export function readSeconds(text: readonly string[]): number {
  const words = text.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(5, Math.ceil(words / WORDS_PER_SECOND / 5) * 5);
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
