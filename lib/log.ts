export const logger = (id?: string, _log?: any) => {
  const loggerInstance = _log || console;

  const log = (...args: any[]) => {
    loggerInstance.log(`[${id}]`, ...args);
  };

  const error = (...args: any[]) => {
    loggerInstance.error(`[${id}]`, ...args);
  };

  const warn = (...args: any[]) => {
    loggerInstance.warn(`[${id}]`, ...args);
  };

  const info = (...args: any[]) => {
    loggerInstance.info(`[${id}]`, ...args);
  };

  const debug = (...args: any[]) => {
    loggerInstance.debug(`[${id}]`, ...args);
  };

  const trace = (...args: any[]) => {
    loggerInstance.trace(`[${id}]`, ...args);
  };

  const blank = () => {
    loggerInstance.log();
  };

  return {
    log,
    error,
    warn,
    info,
    debug,
    trace,
    blank,
  };
};
