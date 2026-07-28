'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database,
  Download,
  X,
  Search,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Eye,
  MapPin,
  Share2,
  Hexagon,
  Globe,
  Radio,
  Wifi,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   ArcGIS Search & Import Panel — OSIRIS OSINT Dashboard
   Premium dark-ops glassmorphism aesthetic
   ═══════════════════════════════════════════════════════════════ */

interface ArcGISResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  owner: string;
  numViews: number;
  extent: number[][];
  tags: string[];
}

export interface ArcGISPanelProps {
  onImportLayer: (layer: { id: string; title: string; url: string; geojson: any }) => void;
  onRemoveLayer: (id: string) => void;
  importedLayers: string[];
  mapBounds?: { west: number; south: number; east: number; north: number } | null;
}

const CATEGORIES = [
  { label: 'Pipelines', query: 'pipeline' },
  { label: 'Power Grid', query: 'power grid transmission' },
  { label: 'Infrastructure', query: 'critical infrastructure' },
  { label: 'Military', query: 'military base installation' },
  { label: 'Emergency', query: 'emergency shelter evacuation' },
] as const;

// Helper to guess geometry type for icon
function getGeometryIcon(title: string, tags: string[] = []) {
  const t = (title + ' ' + tags.join(' ')).toLowerCase();
  if (t.includes('point') || t.includes('location') || t.includes('shelter')) return <MapPin className="w-3 h-3" />;
  if (t.includes('line') || t.includes('route') || t.includes('pipe') || t.includes('grid')) return <Share2 className="w-3 h-3" />;
  if (t.includes('poly') || t.includes('boundary') || t.includes('zone') || t.includes('area')) return <Hexagon className="w-3 h-3" />;
  return <Database className="w-3 h-3" />;
}

export default function ArcGISPanel({
  onImportLayer,
  onRemoveLayer,
  importedLayers,
  mapBounds,
}: ArcGISPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ArcGISResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [featureCounts, setFeatureCounts] = useState<Record<string, number>>({});

  const bboxParam = mapBounds
    ? `${mapBounds.west},${mapBounds.south},${mapBounds.east},${mapBounds.north}`
    : '';

  const runSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) return;
      setSearching(true);
      setError('');
      setResults([]);

      try {
        const params = new URLSearchParams({ q: searchQuery });
        if (bboxParam) params.set('bbox', bboxParam);

        const res = await fetch(`/api/arcgis?${params.toString()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Search failed (${res.status})`);
        }

        const data = await res.json();
        setResults(data.results || []);
      } catch (err: any) {
        setError(err.message || 'Search failed');
      } finally {
        setSearching(false);
      }
    },
    [bboxParam],
  );

  const handleImport = useCallback(
    async (result: ArcGISResult) => {
      if (!result.url) return;
      setImportingId(result.id);
      setError('');

      try {
        const params = new URLSearchParams({ service: result.url });
        if (bboxParam) params.set('bbox', bboxParam);

        const res = await fetch(`/api/arcgis?${params.toString()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Import failed (${res.status})`);
        }

        const geojson = await res.json();
        const count =
          geojson.features?.length ??
          (geojson.type === 'FeatureCollection' ? 0 : 1);

        setFeatureCounts((prev) => ({ ...prev, [result.id]: count }));
        onImportLayer({ id: result.id, title: result.title, url: result.url, geojson });
      } catch (err: any) {
        setError(err.message || 'Import failed');
      } finally {
        setImportingId(null);
      }
    },
    [bboxParam, onImportLayer],
  );

  const handleCategory = (cat: (typeof CATEGORIES)[number]) => {
    const isActive = activeCategory === cat.label;
    setActiveCategory(isActive ? null : cat.label);
    if (!isActive) {
      setQuery(cat.query);
      runSearch(cat.query);
    }
  };

  const totalFeatures = Object.values(featureCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* ── Prominent Stats Header ───────────────────────────────── */}
      <div className="flex items-center justify-between bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded-lg p-2.5">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-[#D4AF37]" />
          <span className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#D4AF37] uppercase">
            ArcGIS Intel
          </span>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-mono text-[#D4AF37]/80 uppercase tracking-widest">
            {importedLayers.length} Layers Active
          </div>
          <div className="text-[11px] font-mono font-bold text-[#D4AF37] tabular-nums">
            {totalFeatures.toLocaleString()} Features
          </div>
        </div>
      </div>

      {/* ── Current Map Extent Indicator ─────────────────────────── */}
      {mapBounds && (
        <div className="flex items-center gap-2 px-2 py-1 rounded border border-white/[0.04] bg-white/[0.02]">
          <Globe className="w-3 h-3 text-[var(--text-muted)]" />
          <span className="text-[8px] font-mono text-[var(--text-muted)] uppercase tracking-wider flex-1">
            Map Extent:
          </span>
          <span className="text-[8px] font-mono text-[var(--text-muted)] tabular-nums truncate max-w-[150px]">
            {mapBounds.west.toFixed(2)}, {mapBounds.south.toFixed(2)} to {mapBounds.east.toFixed(2)}, {mapBounds.north.toFixed(2)}
          </span>
        </div>
      )}

      {/* ── Active Imported Layers (TOP) ─────────────────────────── */}
      {importedLayers.length > 0 && (
        <div className="flex flex-col gap-1.5 shrink-0">
          <span className="text-[8px] font-mono tracking-[0.2em] uppercase text-[var(--text-muted)] px-1">
            Active Data Layers
          </span>
          <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto styled-scrollbar">
            <AnimatePresence>
              {importedLayers.map((id) => {
                const result = results.find((r) => r.id === id);
                const name = result?.title || id;
                const count = featureCounts[id];
                return (
                  <motion.div
                    key={id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-[var(--alert-green)]/[0.08] border border-[var(--alert-green)]/30 backdrop-blur-md"
                  >
                    <CheckCircle className="w-3 h-3 text-[var(--alert-green)] flex-shrink-0" />
                    <span className="text-[10px] font-mono font-medium text-white truncate flex-1">
                      {name}
                    </span>
                    {count !== undefined && (
                      <span className="text-[9px] font-mono font-bold text-[var(--alert-green)] tabular-nums bg-[var(--alert-green)]/10 px-1.5 py-0.5 rounded">
                        {count.toLocaleString()} ft
                      </span>
                    )}
                    <button
                      onClick={() => {
                        onRemoveLayer(id);
                        setFeatureCounts((prev) => {
                          const next = { ...prev };
                          delete next[id];
                          return next;
                        });
                      }}
                      className="p-1 rounded-md text-red-400/60 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                      title="Remove Layer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* ── Search Bar ────────────────────────────────────────── */}
      <div className="relative shrink-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveCategory(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && runSearch(query)}
          placeholder="Search ArcGIS layers..."
          className="w-full bg-black/60 border border-white/10 rounded-lg pl-8 pr-16 py-2.5 text-[11px] font-mono text-white placeholder:text-[var(--text-muted)]/40 focus:outline-none focus:border-[#D4AF37]/50 transition-colors"
        />
        <button
          onClick={() => runSearch(query)}
          disabled={searching || !query.trim()}
          className="absolute right-1 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-md text-[9px] font-mono font-bold tracking-widest uppercase disabled:opacity-30 transition-all bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] hover:bg-[#D4AF37]/20"
        >
          {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'SCAN'}
        </button>
      </div>

      {/* ── Category Quick Filters ────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5 shrink-0">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.label}
            onClick={() => handleCategory(cat)}
            className={`px-3 py-1.5 rounded-full text-[8px] font-mono tracking-[0.1em] uppercase transition-all border ${
              activeCategory === cat.label
                ? 'bg-[#D4AF37]/20 border-[#D4AF37]/50 text-[#D4AF37] shadow-[0_0_12px_rgba(212,175,55,0.3)]'
                : 'bg-white/[0.03] border-white/[0.08] text-[var(--text-muted)] hover:bg-white/[0.06] hover:border-white/20'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* ── Error ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 p-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-[10px] font-mono text-red-400 shrink-0"
          >
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate flex-1">{error}</span>
            <button onClick={() => setError('')} className="p-1 rounded hover:bg-red-500/20 opacity-80 hover:opacity-100">
              <X className="w-3 h-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Search Results ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto styled-scrollbar -mx-1 px-1 space-y-1.5">
        {/* Loading skeleton */}
        {searching && (
          <div className="space-y-2 py-1">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="skeleton-shimmer h-[72px] rounded-lg" />
            ))}
          </div>
        )}

        {/* Results list */}
        <AnimatePresence>
          {!searching &&
            results.map((result, i) => {
              const isImported = importedLayers.includes(result.id);
              const isImporting = importingId === result.id;

              return (
                <motion.div
                  key={result.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: i * 0.05, duration: 0.3, type: 'spring', stiffness: 300, damping: 25 }}
                  className={`group flex flex-col gap-1.5 p-2.5 rounded-lg border transition-all ${
                    isImported
                      ? 'border-[var(--alert-green)]/30 bg-[var(--alert-green)]/[0.05]'
                      : 'border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.04] hover:border-[#D4AF37]/30'
                  }`}
                >
                  {/* Title row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <div className="p-1.5 rounded-md bg-black/40 border border-white/10 text-[#D4AF37]">
                        {getGeometryIcon(result.title, result.tags)}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-[11px] font-mono font-bold text-white leading-tight truncate">
                          {result.title}
                        </h4>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[8px] font-mono text-[var(--text-muted)] truncate">
                            {result.owner}
                          </span>
                          <span className="text-[8px] font-mono text-[#D4AF37]/70 tabular-nums flex items-center gap-0.5">
                            <Eye className="w-2.5 h-2.5" />
                            {result.numViews?.toLocaleString() ?? 0}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Import / Imported badge */}
                    {isImported ? (
                      <span className="flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-mono font-bold tracking-widest uppercase text-[var(--alert-green)] bg-[var(--alert-green)]/10 border border-[var(--alert-green)]/30 shadow-[0_0_10px_rgba(0,230,118,0.2)]">
                        <CheckCircle className="w-3 h-3" />
                        LIVE
                      </span>
                    ) : (
                      <button
                        onClick={() => handleImport(result)}
                        disabled={isImporting || !result.url}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[9px] font-mono font-bold tracking-widest uppercase transition-all disabled:opacity-40 bg-[#D4AF37]/10 border border-[#D4AF37]/40 text-[#D4AF37] hover:bg-[#D4AF37]/20 hover:shadow-[0_0_12px_rgba(212,175,55,0.2)] active:scale-95"
                      >
                        {isImporting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            LOADING...
                          </>
                        ) : (
                          <>
                            <Download className="w-3 h-3" />
                            IMPORT
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Snippet */}
                  {result.snippet && (
                    <p className="text-[9px] font-mono text-[var(--text-muted)]/80 leading-relaxed line-clamp-2 mt-0.5">
                      {result.snippet}
                    </p>
                  )}

                  {/* Tags */}
                  {result.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {result.tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 rounded-full text-[7px] font-mono tracking-wide text-[#D4AF37]/80 bg-[#D4AF37]/10 border border-[#D4AF37]/20"
                        >
                          {tag}
                        </span>
                      ))}
                      {result.tags.length > 4 && (
                        <span className="text-[7px] font-mono text-[var(--text-muted)]/50 flex items-center px-1">
                          +{result.tags.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
        </AnimatePresence>

        {/* Empty state */}
        {!searching && results.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 opacity-60">
            <div className="relative">
              <Database className="w-8 h-8 text-[var(--text-muted)] opacity-50" />
              <Search className="w-4 h-4 text-[#D4AF37] absolute -bottom-1 -right-1" />
            </div>
            <div className="flex flex-col items-center gap-1.5 text-center">
              <span className="text-[11px] font-mono font-bold text-white tracking-wide">
                No active search
              </span>
              <span className="text-[9px] font-mono text-[var(--text-muted)] max-w-[200px] leading-relaxed">
                Try searching for Power Plants, Substations, Evacuation Routes, or Pipelines in the designated area.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Status Bar ────────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] shrink-0">
        <div className="flex items-center gap-1.5">
          <Radio className="w-3 h-3 text-[#D4AF37]" />
          <span className="text-[8px] font-mono tracking-[0.2em] uppercase text-[#D4AF37]/80">
            ArcGIS PUBLIC
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[8px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
            Connection Health
          </span>
          <div className="relative flex items-center justify-center">
            <Wifi className={`w-3 h-3 ${searching ? 'text-[#D4AF37]' : 'text-[var(--alert-green)]'}`} />
            <span
              className={`absolute top-0 right-0 w-1.5 h-1.5 rounded-full ${
                searching
                  ? 'bg-[#D4AF37] animate-ping'
                  : 'bg-[var(--alert-green)] animate-pulse'
              }`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
