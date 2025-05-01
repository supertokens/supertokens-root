import { existsSync } from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';

const toConsole = (serviceId: string) => (data: string) => {
  data
    .toString()
    .split('\n')
    .forEach((line: string) => {
      if (line) process.stdout.write(`[${serviceId}]: ${line}\n`);
    });
};
const toError = (serviceId: string) => (data: string) => {
  data
    .toString()
    .split('\n')
    .forEach((line: string) => {
      if (line) process.stderr.write(`[${serviceId}]: ${line}\n`);
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
}) => {
  const serviceRunScript = service?.runScript && service?.scripts ? service.scripts[service.runScript] : undefined;
  if (!serviceRunScript) {
    return false;
  }

  const runScript = `${service.runtimeSetCommand} && ${serviceRunScript}`;

  console.warn(`Starting service with ${service.runtime}@${service.runtimeVersion}: ${service.id}...`);

  const serviceProcess = exec(runScript, {
    cwd: service.servicePath,
  });

  // Pipe output to main process stdout/stderr with service prefix
  serviceProcess.stdout?.on('data', toConsole(service.id));
  serviceProcess.stderr?.on('data', toError(service.id));

  return serviceProcess;
};
