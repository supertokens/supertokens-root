import path from 'path';
import fs from 'fs';
import { createExampleApp } from './createExampleApp';
import { RecipeConfig } from './types';
import { getRuntimeSetCommand } from './setRuntimeVersion';
import { exec, execSync } from 'child_process';
import { AppConfig } from './validateAppConfig';
import {
  BASE_DIR,
  DEFAULT_FRONTEND_FRAMEWORK,
  DEFAULT_NODE_BACKEND_FRAMEWORK,
  DEFAULT_PYTHON_BACKEND_FRAMEWORK,
} from '../lib';
import { writePythonSDKServiceConfig } from './writeConfig';

export const generateSDKService = async (
  params: (
    | {
        type: 'backend';
        framework: 'express' | 'koa' | 'nest' | 'fastapi' | 'flask' | 'django';
        config?: { clientPort?: number; clientHost?: string; apiHost?: string; coreURI?: string };
      }
    | {
        type: 'frontend';
        framework: 'react' | 'angular' | 'vue' | 'solid' | 'astro' | 'nuxt' | 'sveltekit';
        config?: { apiPort?: number; apiHost?: string };
      }
  ) & {
    port: number;
    host: string;
    outputPath: string;
    force?: boolean;
    appConfig: AppConfig;
  },
) => {
  const frontendFramework = params.type === 'frontend' ? params.framework : 'react';
  const backendFramework = params.type === 'backend' ? params.framework : 'express';

  if (!params.appConfig.template) {
    throw new Error('An SDK service can only be generated if the app config contains a template');
  }

  const clientPort = params.type === 'frontend' ? params.port : params.config?.clientPort;
  const apiPort = params.type === 'backend' ? params.port : params.config?.apiPort;
  if (!clientPort || !apiPort) {
    throw new Error('both clientPort and apiPort must be provided');
  }

  const clientHost = params.type === 'frontend' ? params.host : params.config?.clientHost;
  const apiHost = params.type === 'backend' ? params.host : params.config?.apiHost;
  if (!clientHost || !apiHost) {
    throw new Error('both clientHost and apiHost must be provided');
  }

  const coreURI = params.type === 'backend' ? params.config?.coreURI : undefined;

  console.log(`Creating SDK service at "${params.outputPath}"`);
  const appDir = await createExampleApp({
    frontendFramework,
    backendFramework,
    firstFactors: params.appConfig.template.firstFactors,
    secondFactors: params.appConfig.template.secondFactors,
    providers: params.appConfig.template.providers,
    apiPort,
    clientPort,
    apiHost,
    clientHost,
    coreURI,
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

export const linkNodePackage = async ({
  srcPath,
  servicePath,
  runtimeSetCommand,
}: {
  srcPath: string;
  servicePath: string;
  runtimeSetCommand: string;
}) => {
  const packageName = srcPath.split('/').pop()!;

  console.log(`Linking "${srcPath}" package to "${servicePath}"`);

  const servicePackagePath = path.join(servicePath, 'node_modules', packageName);

  // v1 - leave this commented out for now, as it might provide useful when if we decide to support hot-reloading of packages?
  // todo add support for linking + different/multiple react versions
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
  await new Promise<void>((resolve, reject) => {
    exec(`${runtimeSetCommand} && npm pack`, { cwd: srcPath }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  // extract tarball
  await new Promise<void>((resolve, reject) => {
    exec(
      `tar -xf ${packageName}-*.tgz --strip-components=1 -C ${servicePackagePath}`,
      {
        cwd: srcPath,
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

  // install dependencies
  await new Promise<void>((resolve, reject) => {
    exec(
      `${runtimeSetCommand} && npm install --force --omit=dev`,
      {
        cwd: servicePackagePath,
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

  // clean up tarball
  fs.rmSync(path.join(srcPath, `${packageName}-*.tgz`), { force: true });
};

const linkPythonPackage = async ({
  srcPath,
  servicePath,
  runtimeSetCommand,
}: {
  srcPath: string;
  servicePath: string;
  runtimeSetCommand: string;
}) => {
  console.log(`Linking "${srcPath}" package to "${servicePath}"`);

  await new Promise<void>((resolve, reject) => {
    exec(
      `${runtimeSetCommand} && pip install ${srcPath}`,
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
};

const setupNodeSDKService = async (
  params: Extract<AppConfig['services'][number], { module: 'node' }> & {
    outputPath: string;
    force?: boolean;
    srcPath: string;
    appConfig: AppConfig;
  },
) => {
  const servicePath =
    params.servicePath ||
    (await generateSDKService({
      ...params,
      type: 'backend',
      // @ts-ignore // todo add support for fullstack frameworks
      framework: params?.config?.framework || DEFAULT_NODE_BACKEND_FRAMEWORK,
    }));

  const runtimeSetCommand = await getRuntimeSetCommand({
    id: params.id,
    runtime: 'node',
    runtimeVersion: params.runtimeVersion,
    servicePath,
  });

  console.log(`Installing dependencies for "${servicePath}"`);

  await new Promise<void>((resolve, reject) => {
    exec(
      `${runtimeSetCommand} && npm install`,
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

  await linkNodePackage({ srcPath: params.srcPath, servicePath, runtimeSetCommand });

  return { servicePath, runtimeSetCommand };
};

const setupReactSDKService = async (
  params: Extract<AppConfig['services'][number], { module: 'auth-react' }> & {
    servicePath?: string;
    outputPath: string;
    force?: boolean;
    srcPath: string;
    appConfig: AppConfig;
  },
) => {
  const servicePath =
    params.servicePath ||
    (await generateSDKService({
      ...params,
      type: 'frontend',
      // @ts-ignore // todo add support for fullstack frameworks
      framework: DEFAULT_FRONTEND_FRAMEWORK,
    }));

  const runtimeSetCommand = await getRuntimeSetCommand({
    id: params.id,
    runtime: 'node',
    runtimeVersion: params.runtimeVersion,
    servicePath,
  });

  console.log(`Installing dependencies for "${servicePath}"`);
  await new Promise<void>((resolve, reject) => {
    exec(
      `${runtimeSetCommand} && npm install`,
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

  linkNodePackage({ srcPath: params.srcPath, servicePath, runtimeSetCommand });

  // const webJsService = params.appConfig.services.find((service) => service.module === 'web-js');
  // if (webJsService) {
  //   if (!webJsService.srcPath) {
  //     console.warn(
  //       `Could not link web-js package to auth-react package inside the service path because src path is not provided for service ${webJsService.id}`,
  //     );
  //   } else {
  //     // link web-js package to auth-react package inside the service path
  //     linkNodePackage({
  //       srcPath: path.join(BASE_DIR, webJsService.srcPath),
  //       servicePath: path.join(servicePath),
  //       runtimeSetCommand,
  //     });

  //     linkNodePackage({
  //       srcPath: path.join(BASE_DIR, webJsService.srcPath),
  //       servicePath: path.join(servicePath, 'node_modules', 'supertokens-auth-react'),
  //       runtimeSetCommand,
  //     });
  //   }
  // }

  return { servicePath, runtimeSetCommand };
};

const setupPythonSDKService = async (
  params: Extract<AppConfig['services'][number], { module: 'python' }> & {
    outputPath: string;
    force?: boolean;
    srcPath: string;
    appConfig: AppConfig;
    port: number;
    host: string;
    config?: {
      framework?: 'flask' | 'django' | 'fastapi';
      clientHost?: string;
      clientPort?: number;
      coreURI?: string;
    };
  },
) => {
  const servicePath =
    params.servicePath ||
    (await generateSDKService({
      ...params,
      type: 'backend',
      framework: params.config?.framework || DEFAULT_PYTHON_BACKEND_FRAMEWORK,
    }));

  writePythonSDKServiceConfig({ ...params, servicePath });

  const runtimeSetCommand = await getRuntimeSetCommand({
    id: params.id,
    runtime: 'python',
    runtimeVersion: params.runtimeVersion,
    servicePath,
  });

  console.log(`Installing dependencies for "${servicePath}"`);

  await new Promise<void>((resolve, reject) => {
    exec(
      `${runtimeSetCommand} && source .venv/bin/activate`,
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

  await new Promise<void>((resolve, reject) => {
    exec(
      `${runtimeSetCommand} && pip install -r requirements.txt`,
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

  await linkPythonPackage({ srcPath: params.srcPath, servicePath, runtimeSetCommand });

  return { servicePath, runtimeSetCommand };
};

const setupWebJSService = async (
  params: Extract<AppConfig['services'][number], { module: 'web-js' }> & {
    outputPath: string;
    force?: boolean;
    srcPath: string;
    appConfig: AppConfig;
  },
) => {
  if (!params.config?.framework) {
    throw new Error('framework is required for web-js service');
  }

  const servicePath =
    params.servicePath ||
    (await generateSDKService({
      ...params,
      type: 'frontend',
      // @ts-ignore // todo add support for fullstack frameworks
      framework: params.config?.framework,
    }));

  const runtimeSetCommand = await getRuntimeSetCommand({
    id: params.id,
    runtime: 'node',
    runtimeVersion: params.runtimeVersion,
    servicePath,
  });

  console.log(`Installing dependencies for "${servicePath}"`);
  await new Promise<void>((resolve, reject) => {
    exec(
      `${runtimeSetCommand} && npm install`,
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

  linkNodePackage({ srcPath: params.srcPath, servicePath, runtimeSetCommand });

  return { servicePath, runtimeSetCommand };
};

export const setupService = async (
  service: AppConfig['services'][number] & {
    outputPath: string;
    force?: boolean;
    srcPath: string;
    appConfig: AppConfig;
  },
) => {
  if (service.module === 'node') {
    return setupNodeSDKService(service);
  } else if (service.module === 'auth-react') {
    return setupReactSDKService(service);
  } else if (service.module === 'python') {
    return setupPythonSDKService(service);
  } else if (service.module === 'web-js') {
    return setupWebJSService(service);
  } else {
    throw new Error(`Unsupported service module: ${service.module}`);
  }
};
