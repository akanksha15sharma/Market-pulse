import { Link, useRouteError } from 'react-router';
export function RouteErrorPage() {
  const error = useRouteError();
  return (
    <section className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-3xl font-semibold">Could not load this page</h1>
      <p role="alert" className="mt-4">
        {error instanceof Error ? error.message : 'Please try again.'}
      </p>
      <Link className="mt-6 inline-block text-teal-300" to="/">
        Return home
      </Link>
    </section>
  );
}
