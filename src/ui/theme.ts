import { useColorScheme } from 'react-native';

const light = {
  bg: '#F5F6F8',
  card: '#FFFFFF',
  text: '#14171F',
  muted: '#6B7280',
  border: '#E5E7EB',
  primary: '#2F6FED',
  primarySoft: '#E8EFFE',
  danger: '#D6336C',
  dangerSoft: '#FCE8EF',
  success: '#2B8A3E',
  successSoft: '#E6F4EA',
  warning: '#E67700',
  warningSoft: '#FFF4E0',
  track: '#EEF0F3',
};

const dark: typeof light = {
  bg: '#0E1015',
  card: '#181B22',
  text: '#F1F3F7',
  muted: '#9AA3B2',
  border: '#2A2F3A',
  primary: '#6C9BFF',
  primarySoft: '#1B2740',
  danger: '#FF6B9A',
  dangerSoft: '#3A1824',
  success: '#5CC97A',
  successSoft: '#163020',
  warning: '#FFA94D',
  warningSoft: '#3A2A12',
  track: '#262B35',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

/** Validated categorical palette (light step → dark step). Category colors are stored as light steps. */
const SERIES_DARK: Record<string, string> = {
  '#2a78d6': '#3987e5',
  '#eb6834': '#d95926',
  '#1baf7a': '#199e70',
  '#eda100': '#c98500',
  '#e87ba4': '#d55181',
  '#008300': '#008300',
  '#6250d6': '#9085e9',
  '#e34948': '#e66767',
  '#8a8984': '#6f6e69',
};
export const SERIES_LIGHT = Object.keys(SERIES_DARK);
export const OTHER_COLOR = '#8a8984';

export function useSeriesColor() {
  const dark = useColorScheme() === 'dark';
  return (hex: string | null | undefined) => {
    const h = (hex ?? OTHER_COLOR).toLowerCase();
    return dark ? SERIES_DARK[h] ?? h : h;
  };
}
