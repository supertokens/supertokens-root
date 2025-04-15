#!/usr/bin/env ts-node

import { existsSync, mkdirSync } from 'fs';
import { validateAppConfig, setupService, runService, getAppConfig, BASE_APP_DIR, BASE_DIR } from '../../lib';
import path from 'path';
import { spawn } from 'child_process';

(async () => {
  const rawAppConfig = getAppConfig();
  const appConfig = validateAppConfig(rawAppConfig);

  const appDir = path.join(BASE_APP_DIR, appConfig.name);

  if (!existsSync(appDir)) {
    mkdirSync(appDir, { recursive: true });
  }

  try {
    for await (const service of appConfig.services) {
      // skip services that already have a service path - they already exist
      if (service.servicePath) continue;
      if (!appConfig.template) {
        throw new Error('App config must contain a template if there is not service path provided');
      }
      // todo cleanup this
      if (service.module === 'node') {
      } else if (service.module === 'auth-react') {
      } else {
        continue;
      }

      console.log('--------------------------------');
      console.warn('Processing service:', service.id);

      // resolve the srcPath
      if (!service.srcPath) {
        throw new Error(`Src path is required for service ${service.id}`);
      }

      await setupService({
        ...service,
        firstFactors: appConfig.template.firstFactors,
        secondFactors: appConfig.template.secondFactors,
        providers: appConfig.template.providers,
        outputPath: path.join(appDir, service.id),
        srcPath: path.join(BASE_DIR, service.srcPath),
        config: appConfig,
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

  // Start all services
  const serviceProcesses: Array<{
    process: ReturnType<typeof spawn>;
    servicePath: string;
    id: string;
  }> = [];

  for (const service of appConfig.services) {
    console.log('--------------------------------');

    const servicePath = service.servicePath || path.join(appDir, service.id);

    const serviceProcess = runService({
      id: service.id,
      servicePath,
    });

    if (!serviceProcess) {
      console.warn(`Could not find run script for service ${service.id}, skipping...`);
      continue;
    }

    serviceProcesses.push({
      id: service.id,
      process: serviceProcess,
      servicePath,
    });
  }

  // Handle cleanup when main process exits
  const cleanup = () => {
    for (const { process, id } of serviceProcesses) {
      try {
        process.kill();
        console.warn(`Stopped service: ${id}`);
      } catch (err) {
        console.error(`Failed to stop service: ${id}`, err);
      }
    }
    process.exit();
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
})();
