#!/usr/bin/env ts-node

import { existsSync, mkdirSync } from 'fs';
import { validateAppConfig, setupSDKService, runService, getAppConfig, BASE_APP_DIR } from '../../lib';
import path from 'path';
import { spawn } from 'child_process';

(async () => {
  const rawAppConfig = getAppConfig();
  const appConfig = validateAppConfig(rawAppConfig);

  const appDir = path.join(BASE_APP_DIR, appConfig.name);

  if (!existsSync(appDir)) {
    console.warn(`App directory ${appDir} does not exist. Creating...`);
    mkdirSync(appDir, { recursive: true });
  }

  try {
    for await (const service of appConfig.services) {
      // skip services that already have a service path - they already exist
      if (service.servicePath) continue;
      if (!appConfig.template) {
        throw new Error('App config must contain a template if there is not service path provided');
      }

      console.log('Processing service', service.id);

      // todo cleanup this
      if (service.module === 'node') {
      } else if (service.module === 'auth-react') {
      } else {
        continue;
      }

      // resolve the srcPath
      if (!service.srcPath) {
        throw new Error(`Src path is required for service ${service.id}`);
      }

      const result = await setupSDKService({
        ...service,
        firstFactors: appConfig.template.firstFactors,
        secondFactors: appConfig.template.secondFactors,
        providers: appConfig.template.providers,
        outputPath: path.join(appDir, service.id),
        srcPath: service.srcPath,
      });
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

  // Start all services
  const serviceProcesses: Array<{
    process: ReturnType<typeof spawn>;
    servicePath: string;
  }> = [];

  for (const service of appConfig.services) {
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
      process: serviceProcess,
      servicePath,
    });
  }

  // Handle cleanup when main process exits
  const cleanup = () => {
    console.log('\nStopping all services...');
    for (const { process, servicePath } of serviceProcesses) {
      try {
        process.kill();
        console.log(`Stopped service at "${servicePath}"`);
      } catch (err) {
        console.error(`Failed to stop service at "${servicePath}":`, err);
      }
    }
    process.exit();
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
})();
