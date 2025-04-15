import path from 'path';
import fs from 'fs';
import { createExampleApp } from './createExampleApp';
import { RecipeConfig } from './types';
import { setRuntimeVersion } from './setRuntimeVersion';
import { exec, execSync } from 'child_process';
import { AppConfig } from './validateAppConfig';
import { BASE_DIR } from '../lib';

export const generateSDKService = async (
  params: ({ type: 'backend'; framework: 'express' | 'fastify' } | { type: 'frontend'; framework: 'react' }) & {
    outputPath: string;
    force?: boolean;
  } & RecipeConfig,
) => {
  const frontendFramework = params.type === 'frontend' ? params.framework : 'react';
  const backendFramework = params.type === 'backend' ? params.framework : 'express';

  console.log(`Creating SDK service at "${params.outputPath}"`);
  const appDir = await createExampleApp({
    frontendFramework,
    backendFramework,
    firstFactors: params.firstFactors,
    secondFactors: params.secondFactors,
    providers: params.providers,
  });

  // Copy generated files from CLI output directory to target output path
  if (!fs.existsSync(appDir)) {
    throw new Error(`Expected generated files at "${appDir}" but directory does not exist`);
  }
  if (fs.existsSync(params.outputPath) && !params.force) {
    throw new Error(`Output path "${params.outputPath}" already exists. Set 'force: true' to overwrite.`);
  }

  if (params.force) {
    fs.rmSync(params.outputPath, {
      recursive: true,
      force: true,
    });
  }

  const generatedServiceOutputPath = path.join(appDir, params.type);
  fs.cpSync(generatedServiceOutputPath, params.outputPath, {
    recursive: true,
    force: params.force || false,
  });

  fs.rmSync(appDir, {
    recursive: true,
    force: params.force || false,
  });

  return params.outputPath;
};

export const linkNodePackage = async ({ srcPath, servicePath }: { srcPath: string; servicePath: string }) => {
  const packageName = srcPath.split('/').pop()!;

  console.log(`Linking "${srcPath}" package to "${servicePath}"`);

  const servicePackagePath = path.join(servicePath, 'node_modules', packageName);

  // v1 - leave this commented out for now, as it might provide useful when if we decide to support hot-reloading of packages?
  // Change to service directory before linking
  // await new Promise<void>((resolve, reject) => {
  //   exec(
  //     `npm link`,
  //     {
  //       cwd: srcPath,
  //     },
  //     (error) => {
  //       if (error) {
  //         reject(error);
  //         return;
  //       }
  //       resolve();
  //     },
  //   );
  // });

  // await new Promise<void>((resolve, reject) => {
  //   exec(
  //     `npm link ${srcPath.split('/').pop()}`,
  //     {
  //       cwd: servicePath,
  //     },
  //     (error) => {
  //       if (error) {
  //         reject(error);
  //         return;
  //       }
  //       resolve();
  //     },
  //   );
  // });

  // remove existing installed package
  fs.rmSync(servicePackagePath, { recursive: true, force: true });
  // and create empty directory for it
  fs.mkdirSync(servicePackagePath, { recursive: true });
  // create tarball
  execSync(`npm pack`, { cwd: srcPath, stdio: 'ignore' });
  // extract tarball
  execSync(`tar -xf ${packageName}-*.tgz --strip-components=1 -C ${servicePackagePath}`, {
    cwd: srcPath,
    stdio: 'ignore',
  });
  // install dependencies
  execSync(`npm install --force --omit=dev`, { cwd: servicePackagePath, stdio: 'ignore' });

  // clean up tarball
  fs.rmSync(path.join(srcPath, `${packageName}-*.tgz`), { force: true });
};

const setupNodeSDKService = async (
  params: {
    outputPath: string;
    force?: boolean;
    runtimeVersion: string;
    srcPath: string;
    config?: {
      framework?: 'express' | 'fastify';
    };
  } & RecipeConfig,
) => {
  const servicePath = await generateSDKService({
    ...params,
    type: 'backend',
    framework: params?.config?.framework || 'express',
  });

  await setRuntimeVersion({
    runtime: 'node',
    runtimeVersion: params.runtimeVersion,
    servicePath,
  });

  console.log(`Installing dependencies for "${servicePath}"`);

  await new Promise<void>((resolve, reject) => {
    exec(
      'npm install',
      {
        cwd: servicePath,
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

  await linkNodePackage({ srcPath: params.srcPath, servicePath });

  // create run script
  const runScript = `#!/bin/bash\nnpm run start`;
  fs.writeFileSync(path.join(servicePath, 'run'), runScript);
  // make script executable
  await new Promise<void>((resolve, reject) => {
    exec(
      'chmod +x run',
      {
        cwd: servicePath,
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

  return servicePath;
};

const setupReactSDKService = async (
  params: {
    outputPath: string;
    force?: boolean;
    runtimeVersion: string;
    srcPath: string;
    config: AppConfig;
  } & RecipeConfig,
) => {
  const servicePath = await generateSDKService({ ...params, type: 'frontend', framework: 'react' });

  await setRuntimeVersion({
    runtime: 'node',
    runtimeVersion: params.runtimeVersion,
    servicePath,
  });

  console.log(`Installing dependencies for "${servicePath}"`);
  await new Promise<void>((resolve, reject) => {
    exec(
      'npm install',
      {
        cwd: servicePath,
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

  // create run script
  const runScript = `#!/bin/bash\nnpm run start`;
  fs.writeFileSync(path.join(servicePath, 'run'), runScript);
  // make script executable
  await new Promise<void>((resolve, reject) => {
    exec(
      'chmod +x run',
      {
        cwd: servicePath,
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

  linkNodePackage({ srcPath: params.srcPath, servicePath });

  const webJsService = params.config.services.find((service) => service.module === 'web-js');
  if (webJsService) {
    if (!webJsService.srcPath) {
      console.warn(
        `Could not link web-js package to auth-react package inside the service path because src path is not provided for service ${webJsService.id}`,
      );
    } else {
      // link web-js package to auth-react package inside the service path
      linkNodePackage({
        srcPath: path.join(BASE_DIR, webJsService.srcPath),
        servicePath: path.join(servicePath),
      });

      linkNodePackage({
        srcPath: path.join(BASE_DIR, webJsService.srcPath),
        servicePath: path.join(servicePath, 'node_modules', 'supertokens-auth-react'),
      });
    }
  }

  return servicePath;
};

export const setupService = async (
  service: AppConfig['services'][number] & {
    outputPath: string;
    force?: boolean;
    srcPath: string;
    config: AppConfig;
  } & RecipeConfig,
) => {
  if (service.module === 'node') {
    return setupNodeSDKService(service);
  } else if (service.module === 'auth-react') {
    return setupReactSDKService(service);
  } else {
  }
};
