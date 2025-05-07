#!/usr/bin/env ts-node

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getConfig, validateAppConfig, BASE_APP_DIR } from '../../lib';
import { generateDockerCompose, startDockerCompose, stopDockerCompose } from './docker-compose';

async function main() {
  const configPath = process.argv[2];
  const command = process.argv[3];

  if (!configPath || !command) {
    console.error('Usage: docker.ts <config-path> <start|stop>');
    process.exit(1);
  }

  const rawAppConfig = getConfig(configPath);
  const appConfig = validateAppConfig(rawAppConfig);

  if (appConfig.strategy !== 'docker') {
    console.error('App config strategy must be "docker" to use docker-compose');
    process.exit(1);
  }

  const appDir = join(BASE_APP_DIR, appConfig.name);

  if (!existsSync(appDir)) {
    mkdirSync(appDir, { recursive: true });
  }

  switch (command) {
    case 'start':
      await generateDockerCompose(appConfig, appDir);
      await startDockerCompose(appDir);
      break;
    case 'stop':
      await stopDockerCompose(appDir);
      break;
    default:
      console.error('Invalid command. Use "start" or "stop"');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
