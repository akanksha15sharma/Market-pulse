import { app, stopMarketWorker } from './app.js';
import { env } from './config/env.js';
import { disconnectDatabase } from './db/client.js';

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`MarketPulse API listening on http://${env.HOST}:${env.PORT}`);
});
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    const timeout = setTimeout(() => process.exit(1), 10_000).unref();
    server.close(() => {
      void stopMarketWorker()
        .then(disconnectDatabase)
        .then(() => {
          clearTimeout(timeout);
          process.exit(0);
        })
        .catch(() => process.exit(1));
    });
  });
}
