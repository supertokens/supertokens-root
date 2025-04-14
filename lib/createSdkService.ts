import path from 'path';
import fs from 'fs';
import { createExampleApp } from './createExampleApp';
import { RecipeConfig } from './types';
import { setRuntimeVersion } from './setRuntimeVersion';
import { exec } from 'child_process';
import { AppConfig } from './validateAppConfig';
// TODO: CLI gh issues
// exit code 0 on errors
// wrapper for calling CLI programatically
// optonal output path
// config app names for generated apps (in the actual code)
// allow creating only backend or frontend

export const generateSDKService = async (
  params: ({ type: 'backend'; framework: 'express' } | { type: 'frontend'; framework: 'react' }) & {
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

export const linkLocalNodeSDK = ({ srcPath, servicePath }: { srcPath: string; servicePath: string }) => {
  console.log(`Linking local packages to "${servicePath}"`);
  const sdkPath = path.join(srcPath, '.');
  // Remove any existing symlink before creating new one
  // const serviceSdkPath = path.join(servicePath, 'node_modules', 'supertokens-node');
  // if (fs.existsSync(serviceSdkPath)) {
  //   fs.unlinkSync(serviceSdkPath);
  // }
  // fs.symlinkSync(sdkPath, serviceSdkPath);
};

const linkLocalReactSDK = ({ srcPath, servicePath }: { srcPath: string; servicePath: string }) => {
  console.log(`Linking local packages to "${servicePath}"`);
  const sdkPath = path.join(srcPath, '.');
  // fs.symlinkSync(sdkPath, path.join(servicePath, 'node_modules', 'supertokens-node'));
};

const createNodeSDKService = async (
  params: {
    outputPath: string;
    force?: boolean;
    framework: 'express';
    runtimeVersion: string;
    srcPath: string;
  } & RecipeConfig,
) => {
  const servicePath = await generateSDKService({
    ...params,
    type: 'backend',
    framework: params.framework,
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

  linkLocalNodeSDK({ srcPath: params.srcPath, servicePath });

  // link local packages

  return servicePath;
};

const createReactSDKService = async (
  params: {
    outputPath: string;
    force?: boolean;
    framework: 'react';
    runtimeVersion: string;
    srcPath: string;
  } & RecipeConfig,
) => {
  const servicePath = await generateSDKService({ ...params, type: 'frontend', framework: params.framework });

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

  linkLocalReactSDK({ srcPath: params.srcPath, servicePath });

  return servicePath;
};

export const setupSDKService = async (
  service: AppConfig['services'][number] & {
    outputPath: string;
    force?: boolean;
    srcPath: string;
  } & RecipeConfig,
) => {
  let params: { type: 'backend'; framework: 'express' } | { type: 'frontend'; framework: 'react' };
  if (service.module === 'node') {
    params = {
      type: 'backend',
      framework: 'express',
    };
  } else if (service.module === 'auth-react') {
    params = {
      type: 'frontend',
      framework: 'react',
    };
  } else {
    throw new Error(`Unsupported module: ${service.module}`);
  }

  const createServicePayload = {
    ...params,
    ...service,
  };

  if (service.runtime === 'node' && params.type === 'backend') {
    return createNodeSDKService({ ...createServicePayload, framework: 'express' });
  } else if (service.runtime === 'node' && params.type === 'frontend') {
    return createReactSDKService({ ...createServicePayload, framework: 'react' });
  } else {
    throw new Error(`Unsupported runtime: ${service.runtime}`);
  }
};
