import { isAppError } from './errors';
import { startAddon } from './startup';

// Command-line / development entry. The desktop app uses src/electron/main.ts instead.
const running = await startAddon(process.cwd()).catch((err: unknown) => {
  console.error(`[CONFIG] ${isAppError(err) ? err.message : 'Unknown configuration error'}`);
  console.error('[CONFIG] Fix the .env file (see .env.example) and start again.');
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    running.logger.info({ stage: 'CONFIG' }, 'shutting down');
    void running.stop().then(() => process.exit(0));
  });
}
