import kanitThai from '@fontsource/kanit/files/kanit-thai-600-normal.woff2?url';
import kanitLatin from '@fontsource/kanit/files/kanit-latin-600-normal.woff2?url';
import promptThai from '@fontsource/prompt/files/prompt-thai-600-normal.woff2?url';
import promptLatin from '@fontsource/prompt/files/prompt-latin-600-normal.woff2?url';
import sarabunThai from '@fontsource/sarabun/files/sarabun-thai-600-normal.woff2?url';
import sarabunLatin from '@fontsource/sarabun/files/sarabun-latin-600-normal.woff2?url';
import mitrThai from '@fontsource/mitr/files/mitr-thai-400-normal.woff2?url';
import mitrLatin from '@fontsource/mitr/files/mitr-latin-400-normal.woff2?url';
import notoThai from '@fontsource/noto-sans-thai/files/noto-sans-thai-thai-700-normal.woff2?url';
import notoLatin from '@fontsource/noto-sans-thai/files/noto-sans-thai-latin-700-normal.woff2?url';
import itimThai from '@fontsource/itim/files/itim-thai-400-normal.woff2?url';
import itimLatin from '@fontsource/itim/files/itim-latin-400-normal.woff2?url';
import srirachaThai from '@fontsource/sriracha/files/sriracha-thai-400-normal.woff2?url';
import srirachaLatin from '@fontsource/sriracha/files/sriracha-latin-400-normal.woff2?url';

// All fonts are SIL Open Font License, bundled with the app so text looks the same offline and in the export.
export const FONTS = [
  { id: 'kanit', name: 'Kanit', weight: '600', thai: kanitThai, latin: kanitLatin },
  { id: 'prompt', name: 'Prompt', weight: '600', thai: promptThai, latin: promptLatin },
  { id: 'sarabun', name: 'Sarabun', weight: '600', thai: sarabunThai, latin: sarabunLatin },
  { id: 'mitr', name: 'Mitr', weight: '400', thai: mitrThai, latin: mitrLatin },
  { id: 'noto', name: 'Noto Sans Thai', weight: '700', thai: notoThai, latin: notoLatin },
  { id: 'itim', name: 'Itim', weight: '400', thai: itimThai, latin: itimLatin },
  { id: 'sriracha', name: 'Sriracha', weight: '400', thai: srirachaThai, latin: srirachaLatin },
] as const;

const THAI = 'U+0E01-0E5B, U+200C-200D, U+25CC';
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2212, U+FEFF, U+FFFD';

export const family = (id: string) => `ed-${FONTS.some((f) => f.id === id) ? id : 'kanit'}`;
export const fontCss = (id: string, px: number) => `${FONTS.find((f) => f.id === id)?.weight ?? '600'} ${px}px ${family(id)}, sans-serif`;

let loading: Promise<void> | null = null;

export function loadFonts(): Promise<void> {
  loading ??= (async () => {
    const set = (globalThis as unknown as { document?: Document }).document?.fonts ?? (globalThis as unknown as { fonts: FontFaceSet }).fonts;
    const faces = FONTS.flatMap((f) => [
      new FontFace(family(f.id), `url(${f.thai})`, { weight: f.weight, unicodeRange: THAI }),
      new FontFace(family(f.id), `url(${f.latin})`, { weight: f.weight, unicodeRange: LATIN }),
    ]);
    await Promise.all(faces.map(async (face) => set.add(await face.load())));
  })();
  return loading;
}
