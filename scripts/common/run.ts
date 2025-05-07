#!/usr/bin/env ts-node

import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import {
  validateAppConfig,
  setupTarget,
  runService,
  getConfig,
  BASE_APP_DIR,
  AppConfig,
  getRuntimeSetCommand,
  getRunParams,
  BASE_PACKAGES_DIR,
  MODULE_TARGETS,
  PYTHON_RUNTIME_TARGETS,
  LIB_TARGETS,
  SERVICE_TARGETS,
  withError,
  logger,
} from '../../lib';
import path from 'path';
import { exec, spawn } from 'child_process';
// import { generateDockerCompose, startDockerCompose, stopDockerCompose } from './docker-compose';

withError(async () => {
  const { configPath, script, force } = getRunParams();

  const appConfig = getConfig(configPath, force);
  const log = logger();

  // if (appConfig.strategy === 'docker') {
  //   try {
  //     await generateDockerCompose(appConfig, appDir);
  //     await startDockerCompose(appDir);
  //     return;
  //   } catch (error) {
  //     console.error('Failed to start docker containers:', error);
  //     process.exit(1);
  //   }
  // }

  const servicesToRun: (AppConfig['services'][number] & { runtimeSetCommand: string; servicePath: string })[] = [];

  for await (const service of appConfig.services) {
    log.warn('Setting up');

    const isServiceTarget = SERVICE_TARGETS.includes(service.target as any);
    const isModuleTarget = MODULE_TARGETS.includes(service.target as any);
    const isLibTarget = LIB_TARGETS.includes(service.target as any);

    if (!isServiceTarget && !isModuleTarget && !isLibTarget) {
      throw new Error(`Unsupported service target: ${service.target}`);
    }

    let servicePath: string;
    if (isLibTarget || isModuleTarget) {
      servicePath = path.join(BASE_PACKAGES_DIR, service.target);
    } else {
      // everything else is a service
      servicePath = path.join(appConfig.appDir, service.id);
    }

    const runtimeSetCommand = await getRuntimeSetCommand(service);

    await setupTarget({
      ...service,
      // @ts-ignore
      host: service.host!,
      // @ts-ignore
      port: service.port!,
      libs: service.libs || [],
      config: 'config' in service ? (service.config ?? {}) : {},
      servicePath,
      runtimeSetCommand,
      appConfig,
    });

    servicesToRun.push({
      ...service,
      runtimeSetCommand,
      servicePath,
    });

    log.blank();
  }
  log.blank();

  // Start all startable services
  const serviceProcesses: Array<
    AppConfig['services'][number] & {
      process: ReturnType<typeof spawn>;
      servicePath: string;
    }
  > = [];

  log.info(`Running "${script}"`);

  for (const service of servicesToRun) {
    const serviceProcess = await runService({
      ...service,
      appConfig,
      runScript: script,
    });

    if (!serviceProcess) continue;

    serviceProcesses.push({
      ...service,
      process: serviceProcess,
    });
  }

  // Handle cleanup when main process exits
  const cleanup = () => {
    for (const { process, id, servicePath, target } of serviceProcesses) {
      const log = logger(id);
      try {
        process.kill();
        log.warn(`Stopped service`);
      } catch (err) {
        log.error(`Failed to stop service`, err);
      }

      if (PYTHON_RUNTIME_TARGETS.includes(target as any)) {
        try {
          if (existsSync(path.join(servicePath, '.venv'))) {
            log.info(`Deactivating venv`);

            // Handle venv deactivation
            exec('deactivate', { cwd: servicePath });
            // @ts-ignore
          } else if (process.env.CONDA_DEFAULT_ENV) {
            log.info(`Deactivating conda env`);

            // Handle conda deactivation
            exec('conda deactivate', { cwd: servicePath });
          }
        } catch (err) {
          log.error(`Failed to deactivate Python environment`, err);
        }
      }
    }

    process.exit();
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
});
