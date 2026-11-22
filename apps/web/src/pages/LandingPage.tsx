export function LandingPage() {
  return (
    <section className="max-w-3xl">
      <p className="mb-4 text-sm font-medium uppercase tracking-widest text-teal-300">
        Project foundation
      </p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
        A clearer view of the markets.
      </h1>
      <p className="mt-6 text-lg leading-relaxed text-slate-300">
        MarketPulse is being built to bring crypto and stock prices, watchlists,
        paper portfolios, and price alerts into one place.
      </p>
      <div className="mt-10 rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <h2 className="text-lg font-medium">Development in progress</h2>
        <p className="mt-2 leading-relaxed text-slate-400">
          This initial layout contains no market data or account features.
          Market tracking will arrive in later development phases.
        </p>
      </div>
    </section>
  );
}
