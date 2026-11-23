import { useEffect, useState } from 'react';
import {
  Link,
  useFetcher,
  useLoaderData,
  useRevalidator,
  useSearchParams,
} from 'react-router';
import { WATCHLIST_LIMITS } from '@marketpulse/contracts';
import { loadOverview } from '../features/markets/api';
import { useMarketResource } from '../features/markets/use-market-resource';
import { filterAssets } from '../features/markets/presentation';
import {
  MarketLoading,
  MarketSourcePolicy,
  ResourceError,
} from '../features/markets/MarketComponents';
import { WatchlistAssets } from '../features/watchlists/WatchlistAssets';
import type {
  watchlistsAction,
  watchlistsLoader,
} from '../features/watchlists/actions';

export function WatchlistsPage() {
  const { watchlists } = useLoaderData<typeof watchlistsLoader>();
  const [params] = useSearchParams();
  const selected =
    watchlists.find((list) => list.id === params.get('list')) ?? watchlists[0];
  const fetcher = useFetcher<typeof watchlistsAction>();
  const revalidator = useRevalidator();
  const busy = fetcher.state !== 'idle' || revalidator.state !== 'idle';
  const [query, setQuery] = useState('');
  const [type, setType] = useState('ALL');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const market = useMarketResource(loadOverview);
  useEffect(() => {
    const refresh = () => {
      if (
        !document.hidden &&
        fetcher.state === 'idle' &&
        revalidator.state === 'idle'
      )
        void revalidator.revalidate();
    };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [fetcher.state, revalidator]);
  const matches = filterAssets(market.data?.assets ?? [], query, type, 'name');
  return (
    <div className="market-dashboard watchlists-page">
      <div className="market-heading">
        <div>
          <p className="eyebrow">Your personal market view</p>
          <h1>Keep your interests close.</h1>
          <p className="market-subtitle">
            Private watchlists, saved to your account. The same transparent
            market data.
          </p>
        </div>
        <span className="catalog-chip">
          {watchlists.length} of {WATCHLIST_LIMITS.lists} lists
          <span>Up to {WATCHLIST_LIMITS.items} assets per list</span>
        </span>
      </div>
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
      {fetcher.state !== 'idle' && (
        <p role="status" className="muted">
          Saving your changes…
        </p>
      )}
      <div className="watchlists-layout">
        <aside
          className="market-panel watchlist-sidebar"
          aria-label="Your watchlists"
        >
          <div className="panel-heading">
            <h2>Your watchlists</h2>
            <span className="muted">
              {watchlists.length}/{WATCHLIST_LIMITS.lists}
            </span>
          </div>
          <nav aria-label="Select a watchlist" className="watchlist-nav">
            {watchlists.map((list) => (
              <Link
                key={list.id}
                to={`?list=${list.id}`}
                aria-current={selected?.id === list.id ? 'page' : undefined}
              >
                <span>{list.name}</span>
                <span className="muted">{list.items.length}</span>
              </Link>
            ))}
            {!watchlists.length && (
              <p className="muted">Create your first list to get started.</p>
            )}
          </nav>
          <fetcher.Form
            method="post"
            className="watchlist-create"
            key={watchlists.length}
          >
            <input type="hidden" name="intent" value="create" />
            <label htmlFor="watchlist-name">
              Create a watchlist
              <input
                id="watchlist-name"
                name="name"
                placeholder="e.g. Long-term ideas"
                required
                maxLength={100}
                disabled={busy || watchlists.length >= WATCHLIST_LIMITS.lists}
              />
            </label>
            <button
              className="primary-button"
              disabled={busy || watchlists.length >= WATCHLIST_LIMITS.lists}
            >
              Create list
            </button>
            {watchlists.length >= WATCHLIST_LIMITS.lists && (
              <p className="muted source-name">
                All five list slots are in use.
              </p>
            )}
          </fetcher.Form>
        </aside>
        <div className="watchlist-content">
          {selected ? (
            <>
              <section
                className="market-panel"
                aria-labelledby="saved-assets-heading"
              >
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Saved assets · USD</p>
                    <h2 id="saved-assets-heading" className="watchlist-title">
                      {selected.name}
                    </h2>
                    <p>
                      {selected.items.length} of {WATCHLIST_LIMITS.items} assets
                      saved
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary-button watchlist-danger"
                    disabled={busy}
                    onClick={() => setConfirmDelete(selected.id)}
                  >
                    Delete list
                  </button>
                </div>
                {confirmDelete === selected.id && (
                  <div
                    className="watchlist-confirm"
                    role="group"
                    aria-label="Confirm watchlist deletion"
                  >
                    <p>
                      Delete “{selected.name}” and its {selected.items.length}{' '}
                      saved assets?
                    </p>
                    <p className="muted">
                      This cannot be undone. The assets themselves stay in the
                      market catalog.
                    </p>
                    <div className="watchlist-inline-actions">
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={selected.id} />
                        <button
                          className="secondary-button watchlist-danger"
                          disabled={busy}
                        >
                          Delete this list
                        </button>
                      </fetcher.Form>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => setConfirmDelete(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                <fetcher.Form
                  method="post"
                  className="watchlist-rename"
                  key={`${selected.id}:${selected.name}`}
                >
                  <input type="hidden" name="intent" value="rename" />
                  <input type="hidden" name="id" value={selected.id} />
                  <label htmlFor="rename-list">
                    List name
                    <input
                      id="rename-list"
                      name="name"
                      defaultValue={selected.name}
                      maxLength={100}
                      required
                      disabled={busy}
                    />
                  </label>
                  <button className="secondary-button" disabled={busy}>
                    Rename
                  </button>
                </fetcher.Form>
                {market.loading && <MarketLoading refreshing={!!market.data} />}
                {market.error && (
                  <ResourceError message={market.error} retry={market.retry} />
                )}
                <WatchlistAssets
                  items={selected.items}
                  quotes={market.data?.quotes ?? []}
                  disabled={busy}
                  remove={(asset) => (
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="id" value={selected.id} />
                      <input type="hidden" name="assetId" value={asset.id} />
                      <button
                        className="secondary-button"
                        aria-label={`Remove ${asset.name} from ${selected.name}`}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    </fetcher.Form>
                  )}
                />
              </section>
              <section
                className="market-panel"
                aria-labelledby="add-assets-heading"
              >
                <div className="panel-heading">
                  <div>
                    <h2 id="add-assets-heading">Make it your market.</h2>
                    <p>Add crypto and simulated stocks to {selected.name}.</p>
                  </div>
                </div>
                <div className="catalog-toolbar">
                  <label className="watchlist-search-label">
                    Search catalog
                    <input
                      type="search"
                      placeholder="Name or symbol"
                      value={query}
                      maxLength={100}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <label className="sort-label">
                    Asset type
                    <select
                      value={type}
                      onChange={(event) => setType(event.target.value)}
                    >
                      <option value="ALL">Crypto & stocks</option>
                      <option value="CRYPTO">Crypto</option>
                      <option value="STOCK">Stocks</option>
                    </select>
                  </label>
                </div>
                {selected.items.length >= WATCHLIST_LIMITS.items && (
                  <p className="watchlist-limit" role="status">
                    This list is full. Remove an asset before adding another.
                  </p>
                )}
                <p className="catalog-results" role="status">
                  {matches.length} catalog matches
                </p>
                <ul className="watchlist-picker">
                  {matches.map((asset) => {
                    const saved = selected.items.some(
                      (item) => item.asset.id === asset.id,
                    );
                    return (
                      <li key={asset.id}>
                        <div>
                          <strong>{asset.name}</strong>
                          <span className="muted block">
                            {asset.symbol} ·{' '}
                            {asset.type === 'STOCK'
                              ? 'Simulated stock data'
                              : 'Crypto'}
                          </span>
                        </div>
                        <fetcher.Form method="post">
                          <input type="hidden" name="intent" value="add" />
                          <input type="hidden" name="id" value={selected.id} />
                          <input
                            type="hidden"
                            name="assetId"
                            value={asset.id}
                          />
                          <button
                            className="secondary-button"
                            disabled={
                              busy ||
                              saved ||
                              selected.items.length >= WATCHLIST_LIMITS.items
                            }
                            aria-label={
                              saved
                                ? `${asset.name} is saved`
                                : `Add ${asset.name} to ${selected.name}`
                            }
                          >
                            {saved ? 'Saved' : 'Add'}
                          </button>
                        </fetcher.Form>
                      </li>
                    );
                  })}
                </ul>
                {!matches.length && (
                  <p className="catalog-empty">
                    {market.loading
                      ? 'Loading the catalog…'
                      : market.error
                        ? 'The catalog is unavailable. Retry the market data request above.'
                        : 'No matching assets. Try another name, symbol or type.'}
                  </p>
                )}
              </section>
            </>
          ) : (
            <section className="market-panel catalog-empty">
              <h2 className="text-xl text-slate-100">
                A space for your market ideas.
              </h2>
              <p>
                Create a named list, then add the crypto and stocks you want to
                follow. Your saved perspective stays private to your account.
              </p>
              <Link className="secondary-button" to="/markets">
                Explore markets
              </Link>
            </section>
          )}
        </div>
      </div>
      {market.data && <MarketSourcePolicy status={market.data.status} />}
    </div>
  );
}
