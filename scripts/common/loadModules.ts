#!/usr/bin/env ts-node

import { exec } from 'child_process';
import * as fs from 'fs/promises';
import { simpleGit as git, CloneOptions } from 'simple-git';

async function main() {
  try {
    console.log();
    console.log(`Loading modules...`);

    let modulesProcessed = 0;

    const modulesFile = await fs.readFile('modules.txt', 'utf8');
    const lines = modulesFile.split('\n');

    console.log(`--------------------------------`);
    for await (const l of lines) {
      const line = prepLine(l);
      if (isEmpty(line)) continue;
      if (isComment(line)) continue;
      if (isSkippedModule(line)) continue;

      const { module, branch, username } = mapLineToModuleParts(line);

      console.warn(`Loading module: ${module}`);

      const repoPath = getRepoPath(module);
      const destinationPath = `${PACKAGES_PATH}/${getRepoName(module)}`;

      console.log(`Cloning module: ${module} (${repoPath} -> ${destinationPath})`);

      try {
        await git().clone(repoPath, destinationPath, {
          '--branch': branch,
          '--no-tags': null,
        } as CloneOptions);
      } catch (error) {
        if (error instanceof Error) {
          console.error('Error module:', error.message);
        } else {
          console.error('Error module:', error);
        }
        console.log(`--------------------------------`);
        continue;
      }

      // Process the module info

      if (username) {
        console.log(`Using fork from user: ${username}`);
      }

      if (
        module === 'node' ||
        module === 'auth-react' ||
        module === 'dashboard' ||
        module === 'create-supertokens-app' ||
        module === 'docs'
      ) {
        console.log(`Installing dependencies for ${module}...`);
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
          console.log(`Successfully installed dependencies for ${module}`);
        } catch (error) {
          console.error(`Failed to install dependencies for ${module}:`, error);
        }
      }
      modulesProcessed += 1;

      console.log(``);
      console.log(`--------------------------------`);
    }

    console.log(`Loaded ${modulesProcessed} modules`);
  } catch (error) {
    console.error('Error processing modules:', error);
    process.exit(1);
  }
}

// Execute the main function
main();

const MODULES_TO_SKIP = ['sqlite-plugin', 'core', 'plugin-interface'];
const MODULE_TO_REPO_NAME_MAP = {
  node: 'supertokens-node',
  python: 'supertokens-python',
  'auth-react': 'supertokens-auth-react',
  'web-js': 'supertokens-web-js',
  docs: 'docs',
  dashboard: 'dashboard',
  'create-supertokens-app': 'create-supertokens-app',
};
const PACKAGES_PATH = './packages';
type ModuleName = keyof typeof MODULE_TO_REPO_NAME_MAP;

const prepLine = (line: string) => line.trim();

const isComment = (line: string) => line.startsWith('//');

const isEmpty = (line: string) => !line;

const isSkippedModule = (line: string) =>
  MODULES_TO_SKIP.reduce((acc, module) => acc || line.startsWith(module), false);

const mapLineToModuleParts = (line: string) => {
  const [module, branch, username] = line.split(',').map((part) => part.trim());
  return { module, branch, username } as { module: ModuleName; branch: string; username: string };
};

const getRepoName = (module: ModuleName) => MODULE_TO_REPO_NAME_MAP[module];

const getRepoPath = (module: ModuleName, _username?: string) => {
  const basePath = 'git@github.com:';
  const usernamePath = _username ?? 'supertokens';
  const repoName = getRepoName(module);

  return `${basePath}${usernamePath}/${repoName}.git`;
};
