import type { GlossaryEntry } from './glossary-data';

export function normalizeGlossaryText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function filterGlossary(
  entries: readonly GlossaryEntry[],
  query: string,
): readonly GlossaryEntry[] {
  const normalizedQuery = normalizeGlossaryText(query);
  return entries.filter((entry) =>
    [entry.term, ...(entry.aliases ?? [])].some((term) =>
      normalizeGlossaryText(term).includes(normalizedQuery),
    ),
  );
}

export function groupGlossary(
  entries: readonly GlossaryEntry[],
): readonly { readonly letter: string; readonly entries: readonly GlossaryEntry[] }[] {
  const letters = [
    ...new Set(
      entries.map((entry) => entry.term.charAt(0).normalize('NFD').charAt(0).toUpperCase()),
    ),
  ];
  return letters.map((letter) => ({
    letter,
    entries: entries.filter(
      (entry) => entry.term.charAt(0).normalize('NFD').charAt(0).toUpperCase() === letter,
    ),
  }));
}
