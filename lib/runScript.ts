import { exec } from 'child_process';
import { AppConfig } from './validateAppConfig';
import { logger } from './log';

const toConsole = (log: ReturnType<typeof logger>) => (data: string) => {
  data
    .toString()
    .split('\n')
    .forEach((line: string) => {
      if (line) log.info(line);
    });
};
const toError = (log: ReturnType<typeof logger>) => (data: string) => {
  data
    .toString()
    .split('\n')
    .forEach((line: string) => {
      if (line) log.error(line);
    });
};

export const runScript = async (item: {
  id: string;
  servicePath: string;
  runtime: string;
  runtimeVersion: string;
  runScript?: string;
  scripts?: Record<string, string>;
  config?: any;
  runtimeSetCommand: string;
  appConfig: AppConfig;
  host?: string;
  port?: number;
}) => {
  const log = logger(item.id);

  const serviceRunScript = item?.runScript && item?.scripts ? item.scripts[item.runScript] : undefined;
  if (!serviceRunScript) return;

  const availableEnvVariables: string[] = [];

  const fullConfig = {
    ...item.config,
    host: item?.host,
    port: item?.port,
    id: item?.id,
  };

  const exportConfigCommand = Object.keys(fullConfig)
    .map((key) => {
      if (!fullConfig[key]) return '';

      const exportKey = `ST_${key.replace(/(([a-z])(?=[A-Z][a-zA-Z])|([A-Z])(?=[A-Z][a-z]))/g, '$1_').toUpperCase()}`;

      const envVariable = `${exportKey}=${JSON.stringify(fullConfig[key])}`;

      availableEnvVariables.push(envVariable);

      return `export ${envVariable}`;
    })
    .filter((cmd) => cmd)
    .join(' && ');
  const runScript = [item.runtimeSetCommand, exportConfigCommand, serviceRunScript].filter((cmd) => cmd).join(' && ');

  log.info(`Starting service with`);
  log.info(`Runtime: ${item.runtime}`);
  log.info(`Runtime Version: ${item.runtimeVersion}`);
  log.info(`Environment Variables: ${availableEnvVariables.join(', ')}`);

  const serviceProcess = exec(runScript, {
    cwd: item.servicePath,
  });

  // Pipe output to main process stdout/stderr with service prefix
  serviceProcess.stdout?.on('data', toConsole(log));
  serviceProcess.stderr?.on('data', toError(log));

  return serviceProcess;
};
