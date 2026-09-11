// Splits streaming text into sentences so speech can start before the reply is complete.

const MIN_LENGTH = 24; // avoid tiny fragments like "Sure." being spoken on their own
// Periods after these don't end a sentence (English and Spanish).
const ABBREVIATION = /(?:^|\s)(?:e\.g|i\.e|etc|vs|approx|dr|mr|mrs|ms|prof|sr|sra|dra|p\.\s?ej|no)\.$/i;

export interface SentenceSplitter {
  push: (text: string) => string[];
  flush: () => string | null;
}

export function createSentenceSplitter(): SentenceSplitter {
  let buffer = "";

  return {
    push(text) {
      buffer += text;
      const out: string[] = [];
      // A boundary is ., !, ? or … (optionally followed by a closing quote or bracket) then whitespace.
      const re = /[.!?…]+["'”’)\]]*\s+/g;
      let start = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(buffer))) {
        const end = match.index + match[0].length;
        const candidate = buffer.slice(start, end).trim();
        // Decimals never match (no whitespace after the dot); abbreviations are skipped explicitly.
        if (candidate.length >= MIN_LENGTH && !ABBREVIATION.test(candidate)) {
          out.push(candidate);
          start = end;
        }
      }
      buffer = buffer.slice(start);
      return out;
    },
    flush() {
      const rest = buffer.trim();
      buffer = "";
      return rest || null;
    },
  };
}
