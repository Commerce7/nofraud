import Rollbar from 'rollbar';

const rollbar = new Rollbar({
  accessToken: process.env.ROLLBAR_ACCESS_TOKEN,
  captureUncaught: true,
  captureUnhandledRejections: true
});

const executeRollbar =
  (method) =>
  (...args) => {
    if (process.env.NODE_ENV !== 'production' || !process.env.ROLLBAR_ACCESS_TOKEN) {
      return null;
    }

    return rollbar[method](...args);
  };

// --- Standard Exports ---
export const rollbarCritical = executeRollbar('critical');
export const rollbarError = executeRollbar('error');
export const rollbarWarn = executeRollbar('warning');
export const rollbarInfo = executeRollbar('info');
export const rollbarDebug = executeRollbar('debug');

// Generic log method (first argument passed will be the level string)
export const rollbarLog = executeRollbar('log');
