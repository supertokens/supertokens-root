#!/usr/bin/env ts-node

import { exec } from 'child_process';
import * as fs from 'fs/promises';
import { simpleGit as git, CloneOptions } from 'simple-git';
import { logger } from '../../lib';
import { appendFileSync, cpSync, existsSync, rmSync, writeFileSync } from 'fs';

const PACKAGES_PATH = './packages';
const MODULES_TO_SKIP = ['supertokens-sqlite-plugin'];

const prepLine = (line: string) => line.trim();

const isComment = (line: string) => line.startsWith('//');

const isEmpty = (line: string) => !line;

const isSkippedModule = (line: string) =>
  MODULES_TO_SKIP.reduce((acc, module) => acc || line.startsWith(module), false);

const mapLineToModuleParts = (line: string) => {
  const [module, branch, username] = line.split(',').map((part) => part.trim());
  return { module, branch, username } as { module: string; branch: string; username: string };
};

const getRepoPath = (module: string, _username?: string) => {
  const basePath = 'git@github.com:';
  const usernamePath = _username ?? 'supertokens';
  const repoName = module;

  return `${basePath}${usernamePath}/${repoName}.git`;
};

const force = process.argv.includes('--force');
async function main() {
  const log = logger();

  try {
    if (!force && existsSync(`${PACKAGES_PATH}`)) {
      throw new Error(
        `${PACKAGES_PATH} already exists. Please remove it before running the script or use --force flag`,
      );
    } else if (force) {
      log.info(`Removing ${PACKAGES_PATH}...`);
      rmSync(`${PACKAGES_PATH}`, { recursive: true, force: true });
    }

    log.info(`Loading modules...`);

    let modulesProcessed = 0;

    const modulesFile = await fs.readFile('modules.txt', 'utf8');
    const lines = modulesFile.split('\n');

    log.line();
    for await (const l of lines) {
      const line = prepLine(l);
      if (isEmpty(line)) continue;
      if (isComment(line)) continue;
      if (isSkippedModule(line)) continue;

      const { module, branch, username } = mapLineToModuleParts(line);

      const log = logger(module);

      log.warn(`Loading module`);

      const repoPath = getRepoPath(module);
      const destinationPath = `${PACKAGES_PATH}/${module}`;

      log.info(`Cloning module "${repoPath}" -> "${destinationPath}"`);

      try {
        await git().clone(repoPath, destinationPath, {
          '--branch': branch,
          '--no-tags': null,
        } as CloneOptions);
      } catch (error) {
        if (error instanceof Error) {
          log.error(error.message);
        } else {
          log.error(error);
        }
        log.line();
        continue;
      }

      // Process the module info
      if (username) {
        log.info(`Using fork from user "${username}"`);
      }

      if (module === 'supertokens-core') {
        log.info(`Setting up`);

        if (existsSync(`${PACKAGES_PATH}/settings.gradle`)) {
          rmSync(`${PACKAGES_PATH}/settings.gradle`);
        }

        cpSync('./scripts/core/assets', PACKAGES_PATH, { recursive: true });

        writeFileSync(
          `${PACKAGES_PATH}/settings.gradle`,
          `include 'supertokens-core:cli'\ninclude 'supertokens-core:downloader'\ninclude 'supertokens-core:ee'\n`,
        );
      }

      if (module === 'supertokens-plugin-interface' || module === 'supertokens-core') {
        cpSync('./scripts/core/assets/pre-commit', `${PACKAGES_PATH}/${module}/.git/hooks/pre-commit`, {
          recursive: true,
        });
        cpSync('./scripts/core/assets/addDevTag', `${PACKAGES_PATH}/${module}/addDevTag`, { recursive: true });
        cpSync('./scripts/core/assets/addReleaseTag', `${PACKAGES_PATH}/${module}/addReleaseTag`, { recursive: true });

        appendFileSync(`${PACKAGES_PATH}/settings.gradle`, `include '${module}'\n`);
      }

      if (
        module === 'supertokens-node' ||
        module === 'supertokens-auth-react' ||
        module === 'create-supertokens-app' ||
        module === 'dashboard' ||
        module === 'docs'
      ) {
        log.info(`Setting up`);
        try {
          await new Promise<void>((resolve, reject) => {
            exec(
              'npm install',
              {
                cwd: destinationPath,
              },
              (error) => {
                if (error) {
                  reject(error);
                  return;
                }
                resolve();
              },
            );
          });
          log.info(`Successfully installed dependencies`);
        } catch (error) {
          log.error('Failed to install dependencies');
          log.error(error);
        }
      }
      modulesProcessed += 1;

      log.line();
    }

    log.info(`Loaded ${modulesProcessed} modules`);
  } catch (error) {
    log.error('Error processing modules');
    log.error(error);
    process.exit(1);
  }
}

main();
