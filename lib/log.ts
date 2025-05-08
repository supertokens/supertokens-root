const colors = [
  '\x1b[31m', // red
  '\x1b[32m', // green
  '\x1b[33m', // yellow
  '\x1b[34m', // blue
  '\x1b[35m', // magenta
  '\x1b[36m', // cyan
];

const colorReset = '\x1b[0m';

const usedColors: Record<string, string> = {};

const getColor = (id?: string) => {
  if (!id) return colorReset;

  if (usedColors[id]) return usedColors[id];
  const usedColorValues = Object.values(usedColors);

  const possibleColors = colors.reduce((acc, value) => {
    if (usedColorValues.includes(value)) return acc;
    else return [...acc, value];
  }, [] as string[]);

  let color = colorReset;
  if (possibleColors.length) color = possibleColors[0];

  console.warn('No more colors available for logging. Using default color.');

  usedColors[id] = color;

  return color;
};

export const logger = (id?: string, _log?: any) => {
  const color = getColor(id);

  const loggerInstance = _log || console;
  const getArgs = (...args: any[]) => {
    if (id) return [color, `[${id}]`, colorReset, ...args];
    return args;
  };

  const log = (...args: any[]) => {
    loggerInstance.log(...getArgs(...args));
  };

  const error = (...args: any[]) => {
    loggerInstance.error(...getArgs(...args));
  };

  const warn = (...args: any[]) => {
    loggerInstance.warn(...getArgs(...args));
  };

  const info = (...args: any[]) => {
    loggerInstance.info(...getArgs(...args));
  };

  const debug = (...args: any[]) => {
    loggerInstance.debug(...getArgs(...args));
  };

  const trace = (...args: any[]) => {
    loggerInstance.trace(...getArgs(...args));
  };

  const blank = () => {
    loggerInstance.log();
  };

  const line = () => {
    loggerInstance.log('--------------------------------');
  };

  return {
    log,
    error,
    warn,
    info,
    debug,
    trace,
    blank,
    line,
  };
};
