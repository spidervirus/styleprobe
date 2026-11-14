export interface ColorToken {
  hex: string;
  count: number;
  role?: string;
  luminance: number;
  contrastRatioWithBg?: number;
}

export interface TypographyToken {
  tag: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing?: string;
  color: string;
  sampleText?: string;
}

export interface ComponentSample {
  type: 'button' | 'card' | 'input' | 'badge' | 'nav';
  styles: {
    backgroundColor: string;
    color: string;
    borderRadius: string;
    border: string;
    boxShadow: string;
    padding: string;
    fontSize: string;
    fontWeight: string;
  };
  sampleHtml?: string;
}

export interface ExtractedAsset {
  type: 'logo' | 'icon' | 'svg';
  name: string;
  svgContent?: string;
  url?: string;
}

export interface ThemePalette {
  mode: 'dark' | 'light';
  background: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  primary: string;
  palette: ColorToken[];
}

export interface CssVariableMeta {
  light?: string;
  dark?: string;
  selectors?: string[];
  usedIn?: string[];
}

export interface DesignTokens {
  url: string;
  title: string;
  crawledPages?: string[];
  extractedAt: string;
  themeMode: 'dark' | 'light' | 'mixed';
  colors: {
    background: string;
    surface: string;
    textPrimary: string;
    textSecondary: string;
    border: string;
    primary: string;
    palette: ColorToken[];
  };
  themes?: {
    light: ThemePalette;
    dark: ThemePalette;
  };
  typography: {
    fontFamilies: string[];
    headings: TypographyToken[];
    body: TypographyToken[];
  };
  spacingAndRadii: {
    borderRadii: string[];
    shadows: string[];
  };
  components: ComponentSample[];
  assets: ExtractedAsset[];
  cssVariables: Record<string, string | CssVariableMeta>;
}
