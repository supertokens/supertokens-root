import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';

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

export const runService = (service: { id: string; servicePath: string }) => {
  const runScript = path.join(service.servicePath, 'run');

  if (!existsSync(runScript)) {
    return false;
  }

  console.log(`Starting service ${service.id}...`);

  const serviceProcess = spawn('bash', [runScript], {
    cwd: service.servicePath,
    stdio: 'pipe',
  });

  // Pipe output to main process stdout/stderr with service prefix
  serviceProcess.stdout?.on('data', toConsole(service.id));
  serviceProcess.stderr?.on('data', toError(service.id));

  return serviceProcess;
};
