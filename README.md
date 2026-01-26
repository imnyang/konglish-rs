# Konglish

Konglish is a Korean/English transliteration toolkit that wraps a lightweight G2P beam search with the CMU pronouncing dictionary and a curated Korean override dictionary. It keeps punctuation/spacing intact so you can safely transliterate snippets that mix Korean/English, emoji, or markdown.

## Features

- Uses `cmu-pronouncing-dictionary` when available and falls back to heuristic phones so every word produces at least one candidate.
- Ships with a large Korean override dictionary and lets you provide in-memory overrides per call.
- Preserves non-Latin tokens (numbers, punctuation, emoji, etc.) while transliterating only detected Latin words.
- Beam-search based candidate generation so you can request multiple options ranked by confidence.

## Installation

```bash
pnpm add konglish
# or: npm install konglish / yarn add konglish
```

## API

```ts
import {
  latinToKo,
  latinToKoCandidates,
  type LatinToKoOptions,
} from "konglish";

latinToKo("pretender"); // "프리텐더"
latinToKo("(best day!)"); // "(베스트 데이!)"

latinToKo("pretender", {
  dictionary: {
    pretender: ["프리틴더"], // applied before the built-in dictionary
  },
});

latinToKoCandidates("forever and ever", { limit: 3 });
// -> [ '포레버 앤드 에버', '포레버 앤드 에바', ... ]
```

### Options

All transliteration helpers accept the same base options:

```ts
type LatinToKoOptions = {
  /**
   * Per-call dictionary overrides.
   * Keys are lowercase latin words, values are Hangul candidates (highest priority first).
   */
  dictionary?: Record<string, string[]>;
  /**
   * Beam width used while combining syllable candidates.
   * Defaults to 8 and is auto-clamped so it is always >= the requested output limit.
   */
  beamWidth?: number;
  /**
   * Whether to fall back to heuristic phones when CMUdict has no entry.
   * Enabled by default to avoid zero-candidate cases.
   */
  enableFallbackPhones?: boolean;
};

type LatinToKoCandidatesOptions = LatinToKoOptions & {
  /**
   * Number of phrases you want back. Default: 5.
   */
  limit?: number;
};
```

### Exported dictionary

If you want to inspect or reuse the bundled overrides you can import the built-in dictionary:

```ts
import { customDictionary } from "konglish";
```

## Development

```bash
pnpm install
pnpm test
pnpm build
```

To cut a release:

1. `pnpm test && pnpm build`
2. Update `package.json` version and changelog/README if needed.
3. `pnpm publish --access public`

## Dictionary maintenance

`src/pron/script/mergeDictionaries.ts` merges new entries into `dictionary.ts`. Run `pnpm ts-node src/pron/script/mergeDictionaries.ts --dry-run` to preview merges before regenerating the file.

## License

[MIT](./LICENSE)
