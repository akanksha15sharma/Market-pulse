import { spawn } from 'node:child_process';

// Run with the web tsconfig so tsx uses the same automatic JSX runtime as Vite.
const child = spawn(
  process.execPath,
  [
    '--import',
    'tsx',
    '--test',
    'tests/tradingview.test.tsx',
    'tests/auth.test.tsx',
    'tests/markets.test.tsx',
    'tests/watchlists.test.tsx',
    'tests/live-crypto.test.tsx',
    'tests/alerts.test.tsx',
  ],
  {
    cwd: new URL('../apps/web/', import.meta.url),
    stdio: 'inherit',
  },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
