import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchIcon } from './icons';

// --- Vertical Tabs Component -------------------------------------------------

export interface VerticalTabItem<K extends string = string> {
  key: K;
  label: string;
  description?: string;
  badge?: string | number;
  icon?: ReactNode;
}

export function VerticalTabs<K extends string>({
  items,
  activeKey,
  onSelect,
  ariaLabel = 'Section navigation',
}: {
  items: VerticalTabItem<K>[];
  activeKey: K;
  onSelect: (key: K) => void;
  ariaLabel?: string;
}) {
  return (
    <nav className="vtabs" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            className={`vtab-item ${active ? 'is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {item.icon && (
              <span className="vtab-icon" aria-hidden="true">
                {item.icon}
              </span>
            )}
            <span className="vtab-content">
              <span className="vtab-label">{item.label}</span>
              {item.description && <span className="vtab-desc">{item.description}</span>}
            </span>
            {item.badge !== undefined && (
              <span className={`vtab-badge ${active ? 'is-active' : ''}`}>{item.badge}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

// --- SaaS KPI Stat Cards (Figma .metric-row & .metric design) ----------------

export interface StatMetric {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'accent' | 'danger' | 'purple';
}

export function KpiStatGrid({ items }: { items: StatMetric[] }) {
  const dotTone = (tone?: StatMetric['tone'], idx?: number) => {
    if (tone === 'ok') return 'green';
    if (tone === 'warn') return 'amber';
    if (tone === 'danger') return 'red';
    if (tone === 'accent') return 'blue';
    if (tone === 'purple') return 'purple';
    const cycle = ['green', 'blue', 'amber', 'purple'] as const;
    return cycle[(idx ?? 0) % cycle.length];
  };

  return (
    <div className="kpi-grid">
      {items.map((m, idx) => (
        <div key={m.label} className={`kpi-card ${m.tone ? `kpi-${m.tone}` : ''}`}>
          <div className="kpi-top">
            <span className="kpi-label">{m.label}</span>
            <span className={`kpi-dot kpi-dot-${dotTone(m.tone, idx)}`} aria-hidden="true" />
          </div>
          <strong className="kpi-value">{m.value}</strong>
          {m.sublabel && <span className="kpi-sub">{m.sublabel}</span>}
        </div>
      ))}
    </div>
  );
}

// --- Progress Meter Bar ------------------------------------------------------

export function ProgressBar({
  value,
  max,
  label,
  tone = 'accent',
}: {
  value: number;
  max: number;
  label?: string;
  tone?: 'accent' | 'ok' | 'warn' | 'danger';
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="progress-wrap">
      {label && (
        <div className="progress-head">
          <span className="small muted">{label}</span>
          <strong className="small mono">{pct}%</strong>
        </div>
      )}
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`progress-fill progress-${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// --- Global Command Palette (Ctrl+K / Cmd+K) ---------------------------------

export interface CommandItem {
  id: string;
  label: string;
  group: string;
  hint?: string;
  to?: string;
  action?: () => void;
}

export function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
}) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const filtered = items.filter(
    (i) =>
      !q ||
      i.label.toLowerCase().includes(q) ||
      i.group.toLowerCase().includes(q) ||
      (i.hint && i.hint.toLowerCase().includes(q)),
  );

  const runItem = (item: CommandItem) => {
    onClose();
    if (item.action) item.action();
    else if (item.to) navigate(item.to);
  };

  return (
    <div
      className="cmd-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Quick navigation"
    >
      <div className="cmd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-search-wrap">
          <SearchIcon size={16} className="muted" />
          <input
            type="search"
            className="cmd-input"
            placeholder="Jump to any tab, class, or action…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button type="button" className="cmd-esc" onClick={onClose}>
            ESC
          </button>
        </div>
        <ul className="cmd-list">
          {filtered.map((item) => (
            <li key={item.id}>
              <button type="button" className="cmd-item" onClick={() => runItem(item)}>
                <div>
                  <span className="cmd-item-group">{item.group}</span>
                  <span className="cmd-item-label">{item.label}</span>
                </div>
                {item.hint && <span className="cmd-item-hint mono">{item.hint}</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="cmd-empty muted small">No matching commands found.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
