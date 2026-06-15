import type { ManifestEntry } from "./manifest.ts";

export function searchTools(query: string, entries: ManifestEntry[]): ManifestEntry[] {
  if (query.trim() === "") {
    return [...entries].sort((a, b) => a.name.localeCompare(b.name));
  }
  const q = query.toLowerCase();
  const scored: Array<{ entry: ManifestEntry; score: number }> = [];
  for (const entry of entries) {
    const score = scoreEntry(q, entry);
    if (score !== null) {
      scored.push({ entry, score });
    }
  }
  scored.sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name));
  return scored.map((s) => s.entry);
}

function scoreEntry(query: string, entry: ManifestEntry): number | null {
  const nameScore = matchScore(query, entry.name);
  const idScore = matchScore(query, entry.id);
  if (nameScore === null && idScore === null) return null;
  return Math.min(nameScore ?? Infinity, idScore ?? Infinity);
}

function matchScore(query: string, text: string): number | null {
  let qi = 0;
  let lastMatchPos = -1;
  let score = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) {
      if (lastMatchPos === i - 1) {
        score -= 5;
      } else {
        score += i - lastMatchPos;
      }
      lastMatchPos = i;
      qi++;
    }
  }
  return qi < query.length ? null : score;
}
