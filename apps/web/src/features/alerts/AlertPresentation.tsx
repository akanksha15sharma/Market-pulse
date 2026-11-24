import type { AlertEventView, AlertView } from '@marketpulse/contracts';
import { observed } from '../markets/presentation';
export function AlertEligibility({ alert }: { alert: AlertView }) {
  const messages = {
    real_data_required:
      'Blocked: simulated data. This target is saved, but simulated prices can never trigger it.',
    real_crypto_disabled:
      'Blocked: real crypto mode is disabled. Demo prices can never trigger this alert.',
    inactive_asset: 'Blocked: this asset is no longer in the active catalog.',
    unsupported_source:
      'Price alerts require an authorized native data source. This target remains saved; chart displays cannot trigger it.',
    eligible:
      'Only a fresh real CoinPaprika observation recorded after arming can trigger this alert.',
  };
  return (
    <p
      className={`alert-eligibility ${alert.eligibility === 'eligible' ? 'muted' : 'status-stale'}`}
    >
      {messages[alert.eligibility]}
    </p>
  );
}
export function AlertEventHistory({ events }: { events: AlertEventView[] }) {
  if (!events.length)
    return (
      <p className="catalog-empty">
        No target reached events yet. Paused, simulated and stale observations
        do not create events.
      </p>
    );
  return (
    <ol className="alert-event-list">
      {events.map((event) => (
        <li key={event.id}>
          <div className="alert-event-heading">
            <strong>
              {event.verifiedReal
                ? 'Target reached'
                : 'Legacy event — real provenance not recorded'}
            </strong>
            <span className="muted">Activation {event.activation}</span>
          </div>
          <p>
            Observed{' '}
            {event.verifiedReal ? (
              <strong className="alert-decimal">
                USD {event.observedPrice}
              </strong>
            ) : (
              'price unavailable — source not verified'
            )}
            {event.targetPrice && (
              <>
                {' '}
                · Target{' '}
                <span className="alert-decimal">
                  {event.direction === 'ABOVE' ? '≥' : '≤'} USD{' '}
                  {event.targetPrice}
                </span>
              </>
            )}
          </p>
          <p className="source-name muted">
            {event.provider ?? 'Source unrecorded'} ·{' '}
            {event.mode ?? 'Mode unrecorded'} · Source{' '}
            {observed(event.sourceAt)}
          </p>
          <p className="source-name muted">
            Fetched {observed(event.fetchedAt)} · Reached{' '}
            {observed(event.triggeredAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}
