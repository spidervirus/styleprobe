export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface TokenEvidence {
  sourceType: 'css-variable' | 'computed-style' | 'stylesheet-rule' | 'dom-sampling' | 'media-query';
  selector?: string;
  property?: string;
  value: string;
  ruleText?: string;
  occurrenceCount?: number;
  confidence: ConfidenceLevel;
  reasoning: string;
}

export interface DesignSystemConfidenceReport {
  overallScore: number; // 0 to 100
  level: ConfidenceLevel;
  colorConfidence: ConfidenceLevel;
  typographyConfidence: ConfidenceLevel;
  responsiveConfidence: ConfidenceLevel;
  componentConfidence: ConfidenceLevel;
  evidenceSummary: {
    cssVariablesFound: number;
    computedRolesMatched: number;
    mediaQueriesDetected: number;
    componentsSampled: number;
  };
}

export interface ColorToken {
  hex: string;
  count: number;
  role?: string;
  luminance: number;
  contrastRatioWithBg?: number;
  confidence?: ConfidenceLevel;
  evidence?: TokenEvidence;
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
  count?: number;
  confidence?: ConfidenceLevel;
  evidence?: TokenEvidence;
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
  confidence?: ConfidenceLevel;
  evidence?: TokenEvidence;
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

export interface CrawledPageDetail {
  url: string;
  /**
   * Crawl depth level:
   * - 0: Root target page
   * - 1: Immediate child pages and XML sitemap-seeded entry points
   * - 2+: Secondary pages linked from depth 1 subpages
   */
  depth: number;
}

export interface ExtractOptions {
  /** Maximum crawl depth (1 = root page only, 2 = root + immediate subpages, capped at 3) */
  depth?: number;
  /** Maximum number of unique pages to crawl (default: 6) */
  maxPages?: number;
  /**
   * Discover and seed crawl queue from XML sitemaps (/sitemap.xml, /sitemap_index.xml).
   * Sitemap pages are seeded at depth 1. Only active when depth > 1.
   */
  sitemap?: boolean;
  /**
   * Whether to extract responsive design behavior across desktop, tablet, and mobile viewports.
   * Defaults to true.
   */
  responsive?: boolean;
}

export interface BreakpointToken {
  name?: string;
  value: number;
  unit: string;
  query: string;
  raw: string;
  confidence?: ConfidenceLevel;
  evidence?: TokenEvidence;
}

export interface ViewportSnapshot {
  viewport: 'desktop' | 'tablet' | 'mobile';
  width: number;
  height: number;
  h1FontSize: string;
  h1LineHeight: string;
  h2FontSize?: string;
  bodyFontSize: string;
  sectionPadding: string;
  containerMaxWidth: string;
  gridColumns: string;
  cardGap: string;
  buttonWidth: string;
  buttonPadding: string;
  cardPadding?: string;
  navigationMode: 'Full' | 'Compact' | 'Menu' | 'Hidden';
  navSummary: string;
}

export interface ResponsivePropertyComparison {
  property: string;
  category: 'typography' | 'spacing' | 'layout' | 'navigation' | 'component';
  desktop: string;
  tablet: string;
  mobile: string;
  isFluid?: boolean;
  fluidFormula?: string;
  breakpointRule?: string;
  confidence?: ConfidenceLevel;
  evidence?: TokenEvidence;
}

export interface ResponsiveRule {
  selector?: string;
  property: string;
  behavior: string;
  query?: string;
  isFluid?: boolean;
}

export interface ResponsiveDesignSystem {
  detectedBreakpoints: BreakpointToken[];
  viewports: {
    desktop: ViewportSnapshot;
    tablet: ViewportSnapshot;
    mobile: ViewportSnapshot;
  };
  comparison: ResponsivePropertyComparison[];
  rules: ResponsiveRule[];
  fluidFormulas?: string[];
}

export interface ExtractionTimingBreakdown {
  crawlingMs: number;
  themeExtractionMs: number;
  responsiveExtractionMs?: number;
  formattingMs: number;
  totalMs: number;
}

export interface DesignTokens {
  url: string;
  title: string;
  crawledPages?: string[];
  crawledDetails?: CrawledPageDetail[];
  extractedAt: string;
  themeMode: 'dark' | 'light' | 'mixed';
  timing?: ExtractionTimingBreakdown;
  colors: {
    background: string;
    surface: string;
    textPrimary: string;
    textSecondary: string;
    border: string;
    primary: string;
    palette: ColorToken[];
    evidence?: Record<string, TokenEvidence>;
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
  breakpoints?: BreakpointToken[];
  responsive?: ResponsiveDesignSystem;
  confidence?: DesignSystemConfidenceReport;
}
