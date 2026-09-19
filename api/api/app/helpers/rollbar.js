import Rollbar from 'rollbar';

const rollbar = new Rollbar({
  accessToken: process.env.ROLLBAR_ACCESS_TOKEN,
  captureUncaught: true,
  captureUnhandledRejections: true
});

// Lambda can freeze/recycle the execution environment as soon as a handler
// returns, which can cut off Rollbar's async delivery before it completes.
// Returning a promise that resolves only once the item has actually been
// sent lets callers `await` it before responding, guaranteeing delivery.
// The wait is bounded so a slow/unreachable Rollbar can't hang the actual
// user-facing response -- worst case we just skip reporting this once and
// let the caller continue.
const ROLLBAR_FLUSH_TIMEOUT_MS = 3000;

const executeRollbar =
  (method) =>
  (...args) =>
    new Promise((resolve) => {
      if (process.env.NODE_ENV !== 'production' || !process.env.ROLLBAR_ACCESS_TOKEN) {
        resolve(null);
        return;
      }

      let settled = false;
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, ROLLBAR_FLUSH_TIMEOUT_MS);

      rollbar[method](...args, (err, resp) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          resolve(err ? null : resp);
        }
      });
    });

// --- Standard Exports ---
export const rollbarCritical = executeRollbar('critical');
export const rollbarError = executeRollbar('error');
export const rollbarWarn = executeRollbar('warning');
export const rollbarInfo = executeRollbar('info');
export const rollbarDebug = executeRollbar('debug');

// Generic log method (first argument passed will be the level string)
export const rollbarLog = executeRollbar('log');
