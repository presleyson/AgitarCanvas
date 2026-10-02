import { Font } from '@react-pdf/renderer';
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff?url';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import serif600 from '@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff?url';
import type { BlockGroup } from '@/methodology/agitar';

/**
 * Identidade visual dos documentos PDF. Os valores espelham
 * src/design/tokens.css, que não pode ser lido pelo gerador de PDF.
 */

let registered = false;

export function registerFonts(): void {
  if (registered) return;
  registered = true;

  Font.register({
    family: 'Inter',
    fonts: [
      { src: inter400, fontWeight: 400 },
      { src: inter600, fontWeight: 600 },
      { src: inter700, fontWeight: 700 },
    ],
  });
  Font.register({ family: 'Source Serif', fonts: [{ src: serif600, fontWeight: 600 }] });

  // Sem hifenização automática: as regras embutidas são do inglês.
  Font.registerHyphenationCallback((word) => [word]);
}

export const COLORS = {
  ink: '#10173a',
  text: '#171a2b',
  muted: '#5d627a',
  subtle: '#7e839a',
  border: '#d9dbe6',
  surface: '#ffffff',
  sunken: '#f4f5f9',
  note: '#fff8dc',
  noteBorder: '#ecd98f',
  primary: '#3646d4',
} as const;

export const GROUP_COLORS: Record<BlockGroup, { main: string; soft: string; ink: string }> = {
  estrategia: { main: '#3646d4', soft: '#e9ecff', ink: '#1f2b96' },
  contexto: { main: '#d9543f', soft: '#fdece8', ink: '#9c3323' },
  ideias: { main: '#d99a06', soft: '#fff4d6', ink: '#8a5f00' },
  recursos: { main: '#128f7a', soft: '#dff5f0', ink: '#0b6152' },
};

export const INSTITUTIONAL_FOOTER =
  'AGITAR Canvas · Modelo de gestão da inovação tecnológica para PMEs de TIC (Lima, 2024) · Universidade FUMEC';
