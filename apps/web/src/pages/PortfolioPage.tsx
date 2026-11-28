import { useState } from 'react';
import { Link, useFetcher, useLoaderData, useSearchParams } from 'react-router';
import type {
  portfoliosAction,
  portfoliosLoader,
} from '../features/portfolios/actions';

const money = (value: string | null) =>
  value === null
    ? 'Unavailable'
    : new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
      }).format(Number(value));
const amount = (value: string) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(
    Number(value),
  );
const localDateTime = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};

export function PortfolioPage() {
  const { portfolios, assets } = useLoaderData<typeof portfoliosLoader>();
  const [params] = useSearchParams();
  const fetcher = useFetcher<typeof portfoliosAction>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selected =
    portfolios.find((item) => item.id === params.get('portfolio')) ??
    portfolios[0];
  const busy = fetcher.state !== 'idle';

  return (
    <div className="market-dashboard workspace-page portfolio-page">
      <header className="market-heading">
        <div>
          <p className="eyebrow">Your private investment ledger</p>
          <h1>Track what you own.</h1>
          <p className="market-subtitle">
            Record your own buy and sell fills. Portfolio prices and returns
            appear only when a fresh, genuine market quote is available.
          </p>
        </div>
        <span className="catalog-chip">{portfolios.length} portfolios</span>
      </header>
      {fetcher.data && (
        <p
          className={
            fetcher.data.ok ? 'watchlist-feedback positive' : 'market-error'
          }
          role={fetcher.data.ok ? 'status' : 'alert'}
        >
          {fetcher.data.message}
        </p>
      )}
      {busy && (
        <p className="muted" role="status">
          Saving your changes…
        </p>
      )}

      <div className="portfolio-layout">
        <aside
          className="market-panel portfolio-sidebar"
          aria-label="Your portfolios"
        >
          <div className="panel-heading">
            <h2>Portfolios</h2>
            <span className="muted">{portfolios.length}/10</span>
          </div>
          <nav className="portfolio-nav" aria-label="Select a portfolio">
            {portfolios.map((portfolio) => (
              <Link
                key={portfolio.id}
                to={`?portfolio=${portfolio.id}`}
                aria-current={
                  selected?.id === portfolio.id ? 'page' : undefined
                }
              >
                <span>{portfolio.name}</span>
                <span className="muted">
                  {
                    portfolio.positions.filter(
                      (position) => Number(position.quantity) > 0,
                    ).length
                  }{' '}
                  holdings
                </span>
              </Link>
            ))}
            {!portfolios.length && (
              <p className="muted">
                Create a portfolio to begin recording trades.
              </p>
            )}
          </nav>
          <fetcher.Form method="post" className="portfolio-create">
            <input type="hidden" name="intent" value="create" />
            <label htmlFor="portfolio-name">
              New portfolio
              <input
                id="portfolio-name"
                name="name"
                placeholder="e.g. Long-term holdings"
                maxLength={100}
                required
                disabled={busy || portfolios.length >= 10}
              />
            </label>
            <button
              className="primary-button"
              disabled={busy || portfolios.length >= 10}
            >
              Create portfolio
            </button>
          </fetcher.Form>
        </aside>

        {selected ? (
          <main className="portfolio-content">
            <section
              className="market-panel portfolio-summary"
              aria-labelledby="portfolio-heading"
            >
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Portfolio · USD</p>
                  <h2 id="portfolio-heading">{selected.name}</h2>
                </div>
                <button
                  type="button"
                  className="secondary-button watchlist-danger"
                  disabled={busy}
                  onClick={() => setConfirmDelete((value) => !value)}
                >
                  {confirmDelete ? 'Cancel' : 'Delete portfolio'}
                </button>
              </div>
              {confirmDelete && (
                <div
                  className="portfolio-confirm"
                  role="group"
                  aria-label="Confirm portfolio deletion"
                >
                  <p>
                    Delete “{selected.name}” and its{' '}
                    {selected.transactions.length} recorded trades?
                  </p>
                  <div className="portfolio-actions">
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input
                        type="hidden"
                        name="portfolioId"
                        value={selected.id}
                      />
                      <button
                        className="secondary-button watchlist-danger"
                        disabled={busy}
                      >
                        Delete portfolio and trades
                      </button>
                    </fetcher.Form>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Keep portfolio
                    </button>
                  </div>
                </div>
              )}
              <div className="portfolio-metrics">
                <div>
                  <span>Invested in current holdings</span>
                  <strong>{money(selected.investedAmount)}</strong>
                </div>
                <div>
                  <span>Current value</span>
                  <strong>{money(selected.marketValue)}</strong>
                </div>
                <div>
                  <span>Total return</span>
                  <strong
                    className={
                      selected.totalReturn === null
                        ? 'muted'
                        : Number(selected.totalReturn) < 0
                          ? 'negative'
                          : 'positive'
                    }
                  >
                    {money(selected.totalReturn)}
                    {selected.returnPercent !== null
                      ? ` (${Number(selected.returnPercent).toFixed(2)}%)`
                      : ''}
                  </strong>
                </div>
              </div>
              {!selected.valuationAvailable &&
                selected.positions.some(
                  (position) => Number(position.quantity) > 0,
                ) && (
                  <p className="portfolio-disclosure" role="status">
                    Current valuation and returns are unavailable until every
                    holding has a fresh, authorized real market price. Your
                    recorded trades and invested amounts are preserved.
                  </p>
                )}
              <p className="muted portfolio-disclosure">
                Execution prices are entered by you. MarketPulse does not verify
                fills or replace unavailable prices with simulated data.
              </p>
            </section>

            <section
              className="market-panel"
              aria-labelledby="holdings-heading"
            >
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Current positions</p>
                  <h2 id="holdings-heading">Holdings</h2>
                </div>
              </div>
              {selected.positions.length ? (
                <div className="portfolio-position-list">
                  {selected.positions.map((position) => (
                    <article
                      className="portfolio-position"
                      key={position.asset.id}
                    >
                      <div>
                        <Link to={`/assets/${position.asset.id}`}>
                          <strong>{position.asset.name}</strong>
                        </Link>
                        <span className="muted">
                          {position.asset.symbol} ·{' '}
                          {position.asset.type === 'STOCK' ? 'Stock' : 'Crypto'}
                        </span>
                      </div>
                      <div>
                        <span>Units</span>
                        <strong>{amount(position.quantity)}</strong>
                      </div>
                      <div>
                        <span>Invested</span>
                        <strong>{money(position.investedAmount)}</strong>
                      </div>
                      <div>
                        <span>Market value</span>
                        <strong>{money(position.marketValue)}</strong>
                      </div>
                      <div>
                        <span>Return</span>
                        <strong
                          className={
                            position.totalReturn === null
                              ? 'muted'
                              : Number(position.totalReturn) < 0
                                ? 'negative'
                                : 'positive'
                          }
                        >
                          {money(position.totalReturn)}
                          {position.returnPercent !== null
                            ? ` · ${Number(position.returnPercent).toFixed(2)}%`
                            : ''}
                        </strong>
                      </div>
                      <div className="portfolio-price-source">
                        {position.priceSource
                          ? `${position.priceSource} · observed ${new Date(position.priceObservedAt!).toLocaleString()}`
                          : 'Real market price unavailable'}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="catalog-empty">
                  <h3>No trades recorded yet</h3>
                  <p>Add a buy transaction to start building your holdings.</p>
                </div>
              )}
            </section>

            <section className="market-panel" aria-labelledby="trade-heading">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Manual entry</p>
                  <h2 id="trade-heading">Record a trade</h2>
                </div>
              </div>
              <fetcher.Form method="post" className="portfolio-trade-form">
                <input type="hidden" name="intent" value="add-trade" />
                <input type="hidden" name="portfolioId" value={selected.id} />
                <label>
                  Asset
                  <select
                    name="assetId"
                    required
                    defaultValue=""
                    disabled={busy}
                  >
                    <option value="" disabled>
                      Select an asset
                    </option>
                    {assets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name} ({asset.symbol}) ·{' '}
                        {asset.type === 'STOCK' ? 'Stock' : 'Crypto'}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Action
                  <select name="side" defaultValue="BUY" disabled={busy}>
                    <option value="BUY">Buy</option>
                    <option value="SELL">Sell</option>
                  </select>
                </label>
                <label>
                  Quantity
                  <input
                    type="number"
                    name="quantity"
                    min="0.000000000000000001"
                    step="any"
                    inputMode="decimal"
                    required
                    disabled={busy}
                  />
                </label>
                <label>
                  Execution price (USD)
                  <input
                    type="number"
                    name="unitPrice"
                    min="0.000000000000000001"
                    step="any"
                    inputMode="decimal"
                    required
                    disabled={busy}
                  />
                </label>
                <label>
                  Fee (USD)
                  <input
                    type="number"
                    name="fee"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    defaultValue="0"
                    required
                    disabled={busy}
                  />
                </label>
                <label>
                  Trade date and time
                  <input
                    type="datetime-local"
                    name="executedAt"
                    max={localDateTime()}
                    defaultValue={localDateTime()}
                    required
                    disabled={busy}
                  />
                </label>
                <p className="portfolio-form-note">
                  The entered execution price is saved as part of your ledger.
                  It is not treated as a current market quote.
                </p>
                <button
                  className="primary-button"
                  disabled={busy || !assets.length}
                >
                  Record trade
                </button>
              </fetcher.Form>
            </section>

            <section
              className="market-panel"
              aria-labelledby="transactions-heading"
            >
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Your trade history</p>
                  <h2 id="transactions-heading">Transactions</h2>
                </div>
                <span className="muted">{selected.transactions.length}</span>
              </div>
              {selected.transactions.length ? (
                <div className="portfolio-transaction-list">
                  {selected.transactions.map((transaction) => (
                    <article
                      className="portfolio-transaction"
                      key={transaction.id}
                    >
                      <div>
                        <strong
                          className={
                            transaction.side === 'BUY' ? 'positive' : 'negative'
                          }
                        >
                          {transaction.side}
                        </strong>
                        <span>
                          {transaction.asset.name} ({transaction.asset.symbol})
                        </span>
                      </div>
                      <div>
                        <span>Quantity</span>
                        <strong>{amount(transaction.quantity)}</strong>
                      </div>
                      <div>
                        <span>Execution price</span>
                        <strong>{money(transaction.unitPrice)}</strong>
                      </div>
                      <div>
                        <span>Fee</span>
                        <strong>{money(transaction.fee)}</strong>
                      </div>
                      <div>
                        <span>Executed</span>
                        <strong>
                          {new Date(transaction.executedAt).toLocaleString()}
                        </strong>
                      </div>
                      <fetcher.Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="delete-trade"
                        />
                        <input
                          type="hidden"
                          name="portfolioId"
                          value={selected.id}
                        />
                        <input
                          type="hidden"
                          name="transactionId"
                          value={transaction.id}
                        />
                        <button
                          className="secondary-button watchlist-danger"
                          disabled={busy}
                          aria-label={`Remove ${transaction.side.toLowerCase()} of ${transaction.asset.symbol}`}
                        >
                          Remove
                        </button>
                      </fetcher.Form>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted">Recorded trades will appear here.</p>
              )}
            </section>
          </main>
        ) : (
          <section className="market-panel portfolio-empty">
            <div className="catalog-empty">
              <h2>Create your first portfolio</h2>
              <p>
                Then record your buys and sells to see holdings and invested
                cost.
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
