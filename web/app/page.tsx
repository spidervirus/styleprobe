'use client';

import { useState } from 'react';
import { 
  Copy, 
  Check, 
  Sparkles, 
  ArrowRight, 
  Code, 
  Download, 
  ExternalLink, 
  Sun, 
  Moon, 
  Layers, 
  CheckCircle2, 
  Zap, 
  Lock 
} from 'lucide-react';

interface ThemeTokens {
  background: string;
  surface: string;
  primary: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  palette: string[];
}

interface ProbeResult {
  tokens: {
    title: string;
    url: string;
    themeMode: string;
    colors: ThemeTokens;
    themes?: {
      light: ThemeTokens;
      dark: ThemeTokens;
    };
    typography: {
      fonts: string[];
    };
    assets?: Array<{ type: string; name: string; svgContent: string }>;
  };
  formats: {
    markdown: string;
    shadcn: string;
    tailwindV4: string;
  };
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [activeTab, setActiveTab] = useState<'markdown' | 'shadcn' | 'tailwindV4'>('markdown');
  const [previewMode, setPreviewMode] = useState<'dark' | 'light'>('dark');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = ['stripe.com', 'linear.app', 'github.com', 'vercel.com'];

  const handleProbe = async (targetUrl: string) => {
    if (!targetUrl) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to inspect URL');
      setResult(data);
      setPreviewMode((data.tokens.themeMode as 'dark' | 'light') || 'dark');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.formats[activeTab]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!result) return;
    const content = result.formats[activeTab];
    const filename = activeTab === 'markdown' ? 'design.md' : activeTab === 'shadcn' ? 'globals.css' : 'theme.css';
    const blob = new Blob([content], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  };

  // Get active colors based on preview mode
  const currentColors = result?.tokens.themes 
    ? result.tokens.themes[previewMode] 
    : result?.tokens.colors;

  return (
    <main className="min-h-screen bg-[#09090b] text-[#f4f4f5] flex flex-col items-center px-4 py-16 selection:bg-indigo-500/30">
      {/* Ambient Lighting */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-indigo-500/10 blur-[120px] pointer-events-none rounded-full" />

      {/* Header */}
      <div className="text-center max-w-2xl mx-auto mb-10 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-800 bg-zinc-900/60 text-xs text-zinc-400 mb-6 backdrop-blur-sm">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span>Interactive Visual DNA Extractor</span>
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight mb-4 bg-gradient-to-b from-white via-zinc-200 to-zinc-500 bg-clip-text text-transparent">
          styleprobe
        </h1>
        <p className="text-zinc-400 text-base sm:text-lg">
          Point at any domain. Extract its colors, typography, and visual rules for AI coding agents in seconds.
        </p>
      </div>

      {/* URL Input Form */}
      <div className="w-full max-w-2xl z-10 mb-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleProbe(url);
          }}
          className="relative flex items-center"
        >
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter any domain (e.g. linear.app, stripe.com)"
            className="w-full h-14 pl-5 pr-32 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/80 transition-all text-base shadow-2xl backdrop-blur-md"
          />
          <button
            type="submit"
            disabled={loading || !url}
            className="absolute right-2 h-10 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm flex items-center gap-2 transition-all disabled:opacity-50 disabled:pointer-events-none shadow-lg shadow-indigo-600/20"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>Probe</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Preset Suggestions */}
        <div className="flex items-center gap-2 mt-3 text-xs text-zinc-500">
          <span>Try:</span>
          {presets.map((preset) => (
            <button
              key={preset}
              onClick={() => {
                setUrl(preset);
                handleProbe(preset);
              }}
              className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:text-zinc-300 transition-colors"
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Error Notice */}
      {error && (
        <div className="w-full max-w-2xl p-4 rounded-xl bg-red-950/40 border border-red-800/50 text-red-300 text-sm mb-6 z-10">
          {error}
        </div>
      )}

      {/* Results Workspace */}
      {result && currentColors && (
        <div className="w-full max-w-5xl z-10 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          
          {/* Metadata Card */}
          <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-6 border-b border-zinc-800">
              <div>
                <span className="text-xs uppercase tracking-wider text-indigo-400 font-semibold">Visual DNA</span>
                <h2 className="text-2xl font-bold mt-0.5">{result.tokens.title}</h2>
                <a
                  href={result.tokens.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 mt-1"
                >
                  <span>{result.tokens.url}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* Theme Toggle Pill */}
              <div className="flex items-center gap-2">
                <div className="flex items-center p-1 rounded-xl bg-zinc-950/80 border border-zinc-800">
                  <button
                    onClick={() => setPreviewMode('dark')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                      previewMode === 'dark'
                        ? 'bg-zinc-800 text-white shadow'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <Moon className="w-3 h-3" />
                    <span>Dark</span>
                  </button>
                  <button
                    onClick={() => setPreviewMode('light')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                      previewMode === 'light'
                        ? 'bg-zinc-800 text-white shadow'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <Sun className="w-3 h-3" />
                    <span>Light</span>
                  </button>
                </div>

                <span className="px-3 py-1.5 rounded-xl bg-zinc-800 text-xs font-medium text-zinc-300">
                  {result.tokens.typography.fonts[0] || 'Sans-Serif'}
                </span>
              </div>
            </div>

            {/* Semantic Palette Swatches */}
            <div>
              <h3 className="text-xs uppercase font-medium text-zinc-400 mb-3 tracking-wider">Semantic Colors ({previewMode.toUpperCase()})</h3>
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                {[
                  { label: 'Background', hex: currentColors.background },
                  { label: 'Surface', hex: currentColors.surface },
                  { label: 'Primary', hex: currentColors.primary },
                  { label: 'Text Primary', hex: currentColors.textPrimary },
                  { label: 'Text Muted', hex: currentColors.textSecondary },
                  { label: 'Border', hex: currentColors.border }
                ].map((color) => (
                  <div key={color.label} className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
                    <div
                      className="w-full h-10 rounded-lg mb-2 shadow-inner border border-white/10"
                      style={{ backgroundColor: color.hex }}
                    />
                    <div className="text-[11px] font-medium text-zinc-300 truncate">{color.label}</div>
                    <div className="text-[10px] font-mono text-zinc-500">{color.hex}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* REAL INTERACTIVE CANVAS: Live Re-Styled Pre-Built UI Sections */}
          <div className="rounded-2xl border border-zinc-800/80 overflow-hidden shadow-2xl backdrop-blur-md">
            <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-semibold tracking-wide">Interactive Component Canvas</span>
              </div>
              <span className="text-xs text-zinc-500">Live preview rendered with {result.tokens.title}&apos;s tokens</span>
            </div>

            <div
              className="p-8 sm:p-12 space-y-12 transition-colors duration-300"
              style={{
                backgroundColor: currentColors.background,
                color: currentColors.textPrimary
              }}
            >
              {/* 1. Live Navbar Component */}
              <nav
                className="p-4 rounded-xl border flex items-center justify-between transition-colors shadow-sm"
                style={{
                  backgroundColor: currentColors.surface,
                  borderColor: currentColors.border
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs"
                    style={{
                      backgroundColor: currentColors.primary,
                      color: previewMode === 'dark' ? '#000000' : '#ffffff'
                    }}
                  >
                    SP
                  </div>
                  <span className="font-semibold text-sm" style={{ color: currentColors.textPrimary }}>
                    {result.tokens.title.split(' ')[0]}
                  </span>
                </div>

                <div className="hidden sm:flex items-center gap-6 text-xs font-medium" style={{ color: currentColors.textSecondary }}>
                  <span className="cursor-pointer hover:underline">Features</span>
                  <span className="cursor-pointer hover:underline">Documentation</span>
                  <span className="cursor-pointer hover:underline">Pricing</span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    className="px-4 py-2 rounded-lg text-xs font-medium transition-all shadow-md"
                    style={{
                      backgroundColor: currentColors.primary,
                      color: previewMode === 'dark' ? '#000000' : '#ffffff'
                    }}
                  >
                    Get Started
                  </button>
                </div>
              </nav>

              {/* 2. Live Hero Component */}
              <div className="text-center max-w-xl mx-auto space-y-4">
                <div
                  className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border"
                  style={{
                    backgroundColor: currentColors.surface,
                    borderColor: currentColors.border,
                    color: currentColors.textSecondary
                  }}
                >
                  <Zap className="w-3 h-3" style={{ color: currentColors.primary }} />
                  <span>Next-Generation Visual Design Architecture</span>
                </div>

                <h3 className="text-3xl sm:text-4xl font-extrabold tracking-tight" style={{ color: currentColors.textPrimary }}>
                  Build faster with authentic brand DNA.
                </h3>

                <p className="text-sm leading-relaxed" style={{ color: currentColors.textSecondary }}>
                  Experience accurate styling, elevation, and component hierarchies reverse-engineered directly from your live application.
                </p>

                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    className="px-5 py-2.5 rounded-lg text-xs font-medium transition-all shadow-lg"
                    style={{
                      backgroundColor: currentColors.primary,
                      color: previewMode === 'dark' ? '#000000' : '#ffffff'
                    }}
                  >
                    Start Free Trial
                  </button>
                  <button
                    className="px-5 py-2.5 rounded-lg text-xs font-medium border transition-all"
                    style={{
                      backgroundColor: currentColors.surface,
                      borderColor: currentColors.border,
                      color: currentColors.textPrimary
                    }}
                  >
                    View Components
                  </button>
                </div>
              </div>

              {/* 3. Live Pricing Card & Form Simulation */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
                {/* Pricing Card */}
                <div
                  className="p-6 rounded-2xl border space-y-4 shadow-md transition-colors"
                  style={{
                    backgroundColor: currentColors.surface,
                    borderColor: currentColors.border
                  }}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-base" style={{ color: currentColors.textPrimary }}>Pro Plan</h4>
                      <p className="text-xs" style={{ color: currentColors.textSecondary }}>For engineering & design teams</p>
                    </div>
                    <span
                      className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                      style={{
                        backgroundColor: currentColors.primary,
                        color: previewMode === 'dark' ? '#000000' : '#ffffff'
                      }}
                    >
                      Popular
                    </span>
                  </div>

                  <div className="text-3xl font-extrabold" style={{ color: currentColors.textPrimary }}>
                    $49<span className="text-xs font-normal" style={{ color: currentColors.textSecondary }}>/month</span>
                  </div>

                  <ul className="space-y-2 text-xs" style={{ color: currentColors.textSecondary }}>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5" style={{ color: currentColors.primary }} />
                      <span>Unlimited URL visual probing</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5" style={{ color: currentColors.primary }} />
                      <span>Export to shadcn/ui & Tailwind v4</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5" style={{ color: currentColors.primary }} />
                      <span>SVG & Logo Asset Extraction</span>
                    </li>
                  </ul>

                  <button
                    className="w-full py-2.5 rounded-lg text-xs font-medium transition-all shadow"
                    style={{
                      backgroundColor: currentColors.primary,
                      color: previewMode === 'dark' ? '#000000' : '#ffffff'
                    }}
                  >
                    Upgrade Now
                  </button>
                </div>

                {/* Form Simulation */}
                <div
                  className="p-6 rounded-2xl border space-y-4 shadow-md transition-colors"
                  style={{
                    backgroundColor: currentColors.surface,
                    borderColor: currentColors.border
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4" style={{ color: currentColors.primary }} />
                    <h4 className="font-bold text-base" style={{ color: currentColors.textPrimary }}>Subscribe to Updates</h4>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="text-[11px] font-medium block mb-1" style={{ color: currentColors.textSecondary }}>
                        Email Address
                      </label>
                      <input
                        type="email"
                        readOnly
                        value="developer@company.com"
                        className="w-full px-3 py-2 rounded-lg text-xs border focus:outline-none"
                        style={{
                          backgroundColor: currentColors.background,
                          borderColor: currentColors.border,
                          color: currentColors.textPrimary
                        }}
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-medium block mb-1" style={{ color: currentColors.textSecondary }}>
                        Organization Key
                      </label>
                      <input
                        type="password"
                        readOnly
                        value="••••••••••••"
                        className="w-full px-3 py-2 rounded-lg text-xs border focus:outline-none"
                        style={{
                          backgroundColor: currentColors.background,
                          borderColor: currentColors.border,
                          color: currentColors.textPrimary
                        }}
                      />
                    </div>
                  </div>

                  <button
                    className="w-full py-2.5 rounded-lg text-xs font-medium border transition-all"
                    style={{
                      backgroundColor: currentColors.background,
                      borderColor: currentColors.border,
                      color: currentColors.textPrimary
                    }}
                  >
                    Confirm Credentials
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Code Tabs & Exporter */}
          <div className="rounded-2xl bg-zinc-900/60 border border-zinc-800/80 overflow-hidden backdrop-blur-md">
            {/* Tabs Header */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 bg-zinc-950/40">
              <div className="flex items-center gap-1">
                {[
                  { id: 'markdown', label: 'design.md' },
                  { id: 'shadcn', label: 'shadcn/ui (globals.css)' },
                  { id: 'tailwindV4', label: 'Tailwind v4 (theme.css)' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'bg-zinc-800 text-white shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition-colors shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
              </div>
            </div>

            {/* Code Body */}
            <pre className="p-6 text-xs font-mono text-zinc-300 overflow-x-auto max-h-[400px] leading-relaxed selection:bg-zinc-800">
              <code>{result.formats[activeTab]}</code>
            </pre>
          </div>
        </div>
      )}

      {/* Footer CLI snippet */}
      <div className="mt-16 text-center text-xs text-zinc-500 z-10 flex flex-col items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 font-mono text-zinc-400">
          <Code className="w-3.5 h-3.5 text-indigo-400" />
          <span>npx styleprobe https://example.com</span>
        </div>
        <p>
          Open source project on{' '}
          <a
            href="https://github.com/spidervirus/styleprobe"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-400 hover:text-white underline underline-offset-4"
          >
            GitHub
          </a>
        </p>
      </div>
    </main>
  );
}
