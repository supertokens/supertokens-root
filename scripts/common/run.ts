#!/usr/bin/env ts-node

import { existsSync } from 'fs';
import {
  setupTarget,
  runScript,
  getConfig,
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

  const itemsToRun: (AppConfig['items'][number] & {
    runtimeSetCommand: string;
    servicePath: string;
    process?: ReturnType<typeof spawn>;
  })[] = [];

  for await (const service of appConfig.items) {
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
      // @ts-ignore
      config: service.config || {},
      servicePath,
      runtimeSetCommand,
      appConfig,
      force,
    });

    itemsToRun.push({
      ...service,
      runtimeSetCommand,
      servicePath,
    });

    log.blank();
  }
  log.blank();

  log.info(`Running "${script}"`);

  for (const item of itemsToRun) {
    item.process = await runScript({
      ...item,
      appConfig,
      runScript: script,
    });
  }

  // Handle cleanup when main process exits
  const cleanup = () => {
    for (const item of itemsToRun) {
      if (!item.process) continue;

      const log = logger(item.id);
      try {
        item.process?.kill();
        log.warn(`Stopped service`);
      } catch (err) {
        log.error(`Failed to stop service`, err);
      }

      if (PYTHON_RUNTIME_TARGETS.includes(item.target as any)) {
        try {
          if (existsSync(path.join(item.servicePath, '.venv'))) {
            log.info(`Deactivating venv`);

            // Handle venv deactivation
            exec('deactivate', { cwd: item.servicePath });
            // @ts-ignore
          } else if (process.env.CONDA_DEFAULT_ENV) {
            log.info(`Deactivating conda env`);

            // Handle conda deactivation
            exec('conda deactivate', { cwd: item.servicePath });
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
