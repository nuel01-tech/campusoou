import {
  forwardRef,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { Link } from 'react-router-dom';
import type { AppError } from '@/lib/errors';
import { CheckCircle2Icon, Clock3Icon, XCircleIcon } from './icons';

// --- Button ------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'lg' | 'sm';
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, block, disabled, className = '', children, ...rest },
  ref,
) {
  const cls = ['btn', `btn-${variant}`, `btn-${size}`, block && 'btn-block', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      ref={ref}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner small />}
      <span className="btn-content">{children}</span>
    </button>
  );
});

/** A destructive button that asks for a second click instead of a modal. */
export function ConfirmButton({
  onConfirm,
  children,
  confirmText = 'Tap again to confirm',
  ...rest
}: Omit<ButtonProps, 'onClick'> & { onConfirm: () => void; confirmText?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      variant={armed ? 'danger' : 'ghost'}
      {...rest}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmText : children}
    </Button>
  );
}

// --- Form fields -------------------------------------------------------------

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField(
  { label, hint, error, id, className = '', ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  return (
    <div className={`field ${error ? 'field-invalid' : ''} ${className}`}>
      <label htmlFor={inputId}>{label}</label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={hint || error ? hintId : undefined}
        {...rest}
      />
      {(error || hint) && (
        <p id={hintId} className={error ? 'field-error' : 'field-hint'}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}

export function SelectField({ label, hint, error, id, className = '', children, ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const hintId = `${selectId}-hint`;
  return (
    <div className={`field ${error ? 'field-invalid' : ''} ${className}`}>
      <label htmlFor={selectId}>{label}</label>
      <select
        id={selectId}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={hint || error ? hintId : undefined}
        {...rest}
      >
        {children}
      </select>
      {(error || hint) && (
        <p id={hintId} className={error ? 'field-error' : 'field-hint'}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

// --- Feedback ----------------------------------------------------------------

export function Spinner({ small }: { small?: boolean }) {
  return <span className={`spinner ${small ? 'spinner-sm' : ''}`} aria-hidden="true" />;
}

export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="page-loader" role="status">
      <Spinner />
      <span>{label}…</span>
    </div>
  );
}

export function Alert({
  tone = 'error',
  title,
  children,
  action,
}: {
  tone?: 'error' | 'success' | 'info' | 'warning';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="alert-body">
        {title && <strong className="alert-title">{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="alert-action">{action}</div>}
    </div>
  );
}

export function ErrorAlert({ error, onRetry }: { error: AppError | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <Alert
      tone="error"
      action={
        onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )
      }
    >
      {error.message}
    </Alert>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="empty-text">{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

// --- Layout & Typography -----------------------------------------------------

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  back,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      {back && (
        <Link to={back.to} className="back-link">
          ← {back.label}
        </Link>
      )}
      <div className="page-header-row">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          {subtitle && <div className="page-subtitle">{subtitle}</div>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}

export type BadgeTone = 'neutral' | 'live' | 'muted' | 'ok' | 'warn' | 'danger' | 'info' | 'purple';

export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {icon}
      {children}
    </span>
  );
}

/** Figma-style status pill with semantic SVG icon + label */
export function StatusPill({
  status,
  label,
}: {
  status: 'present' | 'late' | 'excused' | 'absent';
  label?: ReactNode;
}) {
  const tone =
    status === 'present'
      ? 'present'
      : status === 'late' || status === 'excused'
        ? 'late'
        : 'absent';
  const defaultLabel =
    status === 'present'
      ? 'Present'
      : status === 'late'
        ? 'Late'
        : status === 'excused'
          ? 'Excused'
          : 'Absent';
  return (
    <span className={`status-pill status-pill-${tone}`}>
      {status === 'present' ? (
        <CheckCircle2Icon size={12} />
      ) : status === 'late' || status === 'excused' ? (
        <Clock3Icon size={12} />
      ) : (
        <XCircleIcon size={12} />
      )}
      <span>{label ?? defaultLabel}</span>
    </span>
  );
}

export function getInitials(name: string): string {
  return (name || 'CP')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

/** Figma-style Student / Person cell with avatar initials circle */
export function StudentCell({
  name,
  subtext,
  badges,
  muted,
}: {
  name: string;
  subtext?: ReactNode;
  badges?: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="student-cell">
      <span className="avatar" aria-hidden="true">
        {getInitials(name)}
      </span>
      <div className="student-cell-info">
        <div className="student-cell-title">
          <strong className={muted ? 'muted' : undefined}>{name}</strong>
          {badges}
        </div>
        {subtext && <span className="student-cell-sub">{subtext}</span>}
      </div>
    </div>
  );
}
