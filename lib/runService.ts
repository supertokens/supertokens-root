import { existsSync } from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
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

export const runService = async (service: {
  id: string;
  servicePath: string;
  runtime: string;
  runtimeVersion: string;
  runScript?: string;
  scripts?: Record<string, string>;
  runtimeSetCommand: string;
  appConfig: AppConfig;
}) => {
  const log = logger(service.id);

  const serviceRunScript = service?.runScript && service?.scripts ? service.scripts[service.runScript] : undefined;
  if (!serviceRunScript) {
    return false;
  }

  const runScript = [service.runtimeSetCommand, serviceRunScript].filter((cmd) => cmd).join(' && ');

  log.info(`Starting service with ${service.runtime}@${service.runtimeVersion} ...`);

  const serviceProcess = exec(runScript, {
    cwd: service.servicePath,
  });

  // Pipe output to main process stdout/stderr with service prefix
  serviceProcess.stdout?.on('data', toConsole(log));
  serviceProcess.stderr?.on('data', toError(log));

  return serviceProcess;
};
