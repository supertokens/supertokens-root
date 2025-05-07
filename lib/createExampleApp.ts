import { exec } from 'child_process';
import path from 'path';
import { RecipeConfig } from './types';
import { ServiceTarget } from './constants';

export const createExampleApp = async (
  params: {
    frontendFramework: ServiceTarget.React | ServiceTarget.Angular | ServiceTarget.Vue | ServiceTarget.Solid;
    backendFramework:
      | ServiceTarget.Express
      | ServiceTarget.Nest
      | ServiceTarget.Koa
      | ServiceTarget.FastAPI
      | ServiceTarget.Flask
      | ServiceTarget.Django;
    apiHost: string;
    clientHost: string;
    apiPort: number;
    clientPort: number;
    coreURI?: string;
  } & RecipeConfig,
): Promise<string> => {
  const appName = `app-${Math.random().toString(36).substring(2, 8)}`;

  const cliPath = path.join(process.cwd(), 'packages', 'create-supertokens-app');

  const command = [
    'npm run dev --',
    `--frontend ${params.frontendFramework}`,
    `--backend ${params.backendFramework}`,
    `--firstfactors ${params.firstFactors.join(' ')}`,
    `--secondfactors ${params.secondFactors?.join(' ') || ''}`,
    `--providers ${params.providers?.join(' ') || ''}`,
    `--appname ${appName}`,
    `--apiport ${params.apiPort}`,
    `--apihost ${params.apiHost}`,
    `--clientport ${params.clientPort}`,
    `--clienthost ${params.clientHost}`,
    `--coreuri ${params.coreURI}`,
    '--skip-install',
  ]
    .filter((c) => c)
    .join(' ');

  const child = exec(command, {
    cwd: cliPath,
  });

  // we assume this always succeeds until below are fixed
  const result = await new Promise<void>((resolve, reject) => {
    let output = '';
    let error = '';

    child.stdout?.on('data', (data) => {
      output += data;
    });

    child.stderr?.on('data', (data) => {
      error += data;
    });

    child.on('close', async (code) => {
      // todo this needs to be handled correctly. atm, when there is an error, it still exits with code 0
      if (code !== 0) {
        reject();
      } else {
        resolve();
      }
    });
  });

  return path.join(cliPath, appName);
};
