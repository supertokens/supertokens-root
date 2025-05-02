#!/usr/bin/env ts-node

import { existsSync, mkdirSync } from 'fs';
import {
  validateAppConfig,
  setupService,
  runService,
  getAppConfig,
  BASE_APP_DIR,
  BASE_DIR,
  AppConfig,
} from '../../lib';
import path from 'path';
import { exec, spawn } from 'child_process';

(async () => {
  const rawAppConfig = getAppConfig();
  const appConfig = validateAppConfig(rawAppConfig);

  const runScript = process.argv[3];
  if (!runScript) {
    throw new Error('Run script is required');
  }

  const appDir = path.join(BASE_APP_DIR, appConfig.name);

  if (!existsSync(appDir)) {
    mkdirSync(appDir, { recursive: true });
  }

  const servicesToRun: (AppConfig['services'][number] & { runtimeSetCommand: string; servicePath: string })[] = [];

  try {
    for await (const service of appConfig.services) {
      // skip services that already have a service path - they already exist
      if (!appConfig.template) {
        throw new Error('App config must contain a template if there is not service path provided');
      }

      // todo cleanup this
      if (service.module === 'node') {
      } else if (service.module === 'auth-react') {
      } else if (service.module === 'web-js') {
      } else if (service.module === 'python') {
      } else if (service.module === 'core') {
      } else {
        continue;
      }

      console.warn('Processing service:', service.id);

      // resolve the srcPath
      if (!service.srcPath) {
        throw new Error(`Src path is required for service ${service.id}`);
      }

      const { runtimeSetCommand, servicePath } = await setupService({
        ...service,
        servicePath: path.join(appDir, service.id),
        srcPath: path.join(BASE_DIR, service.srcPath),
        appConfig,
      });

      servicesToRun.push({
        ...service,
        runtimeSetCommand,
        servicePath,
      });

      console.log();
    }
  } catch (error) {
    console.log();

    if (error instanceof Error) {
      console.error(error.name, error.message);
    } else {
      console.error(error);
    }

    process.exit(1);
  }
  console.log();

  // Start all startable services
  const serviceProcesses: Array<
    AppConfig['services'][number] & {
      process: ReturnType<typeof spawn>;
      servicePath: string;
    }
  > = [];

  console.log(`Running services with "${runScript}"...`);
  for (const service of servicesToRun) {
    console.log(`Running service: ${service.id} at ${service.servicePath}`);
    const serviceProcess = await runService({
      ...service,
      runScript,
    });

    if (!serviceProcess) {
      // console.warn(`Could not find run script for service ${service.id}, skipping...`);
      continue;
    }

    serviceProcesses.push({
      ...service,
      process: serviceProcess,
    });
  }

  // Handle cleanup when main process exits
  const cleanup = () => {
    for (const { process, id, servicePath, module } of serviceProcesses) {
      try {
        process.kill();
        console.warn(`Stopped service: ${id}`);
      } catch (err) {
        console.error(`Failed to stop service: ${id}`, err);
      }

      if (module === 'python') {
        try {
          if (existsSync(path.join(servicePath, '.venv'))) {
            console.log(`Deactivating venv for service: ${id}`);

            // Handle venv deactivation
            exec('deactivate', { cwd: servicePath });
            // @ts-ignore
          } else if (process.env.CONDA_DEFAULT_ENV) {
            console.log(`Deactivating conda env for service: ${id}`);

            // Handle conda deactivation
            exec('conda deactivate', { cwd: servicePath });
          }
        } catch (err) {
          console.error(`Failed to deactivate Python environment for service: ${id}`, err);
        }
      }
    }

    process.exit();
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
})();
