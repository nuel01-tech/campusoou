import { Link } from 'react-router-dom';
import { useAsync, useNow } from '@/hooks/useAsync';
import { listSessionsWithCounts } from '@/services/sessions';
import { Badge, EmptyState, ErrorAlert, PageLoader } from '@/components/ui';
import { PlusIcon } from '@/components/icons';
import { formatDate, formatTime, isOpen, timeLeft } from '@/lib/format';
import type { ClassRoom } from '@/types';

export function SessionsTab({ klass }: { klass: ClassRoom }) {
  const sessions = useAsync(() => listSessionsWithCounts(klass.id), [klass.id]);
  const now = useNow(30_000);

  const newLink = (
    <Link to={`/rep/class/${klass.id}/new-session`} className="btn btn-primary btn-sm">
      <PlusIcon size={14} />
      <span>Start a session</span>
    </Link>
  );

  if (sessions.loading) return <PageLoader />;

  const list = sessions.data ?? [];
  return (
    <div className="panel stack">
      <div className="section-head">
        <div>
          <h2>Lecture Sessions</h2>
          <p className="muted small">
            Select any session to view real-time check-ins, project the QR code, or run a batch roll-call.
          </p>
        </div>
        {list.length > 0 && newLink}
      </div>
      <ErrorAlert error={sessions.error} onRetry={() => sessions.reload()} />

      {list.length === 0 && !sessions.error ? (
        <EmptyState title="No sessions yet" action={newLink}>
          Start a session when you're in the lecture room. Students within the radius can check in until it closes.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Course</th>
                <th>Venue</th>
                <th className="num">Week</th>
                <th>Date & Time</th>
                <th className="num">Present</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const live = isOpen(s, now);
                return (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/rep/session/${s.id}`} className="strong-link">
                        {s.course_code}
                      </Link>
                    </td>
                    <td>{s.venue}</td>
                    <td className="num mono">Week {s.week}</td>
                    <td className="nowrap muted">
                      {formatDate(s.starts_at)}, {formatTime(s.starts_at)}
                    </td>
                    <td className="num font-bold">{s.present}</td>
                    <td>
                      {live ? (
                        <Badge tone="live">Live · {timeLeft(s.ends_at, now)}</Badge>
                      ) : (
                        <Badge tone="muted">Closed</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
