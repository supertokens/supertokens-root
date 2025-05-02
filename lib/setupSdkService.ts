import path from 'path';
import fs from 'fs';
import { createExampleApp } from './createExampleApp';
import { exec } from 'child_process';
import { AppConfig } from './validateAppConfig';
import {
  BASE_TMP_DIR,
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
    servicePath: string;
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

  console.log(`Creating SDK service at "${params.servicePath}"`);
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
  if (fs.existsSync(params.servicePath) && !params.force) {
    throw new Error(`Output path "${params.servicePath}" already exists. Set 'force: true' to overwrite.`);
  }

  if (params.force) {
    fs.rmSync(params.servicePath, {
      recursive: true,
      force: true,
    });
  }

  const generatedServiceOutputPath = path.join(appDir, params.type);
  fs.cpSync(generatedServiceOutputPath, params.servicePath, {
    recursive: true,
    force: params.force || false,
  });

  fs.rmSync(appDir, {
    recursive: true,
    force: params.force || false,
  });

  return params.servicePath;
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
    servicePath: string;
    force?: boolean;
    srcPath: string;
    appConfig: AppConfig;
    runtimeSetCommand: string;
  },
) => {
  await generateSDKService({
    ...params,
    type: 'backend',
    // @ts-ignore // todo add support for fullstack frameworks
    framework: params?.config?.framework || DEFAULT_NODE_BACKEND_FRAMEWORK,
  });

  console.log(`Installing dependencies for "${params.servicePath}"`);

  await new Promise<void>((resolve, reject) => {
    exec(
      `${params.runtimeSetCommand} && npm install`,
      {
        cwd: params.servicePath,
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

  await linkNodePackage(params);

  return true;
};

const setupReactSDKService = async (
  params: Extract<AppConfig['services'][number], { module: 'auth-react' }> & {
    servicePath: string;
    force?: boolean;
    srcPath: string;
    appConfig: AppConfig;
    runtimeSetCommand: string;
  },
) => {
  await generateSDKService({
    ...params,
    type: 'frontend',
    // @ts-ignore // todo add support for fullstack frameworks
    framework: DEFAULT_FRONTEND_FRAMEWORK,
  });

  console.log(`Installing dependencies for "${params.servicePath}"`);
  await new Promise<void>((resolve, reject) => {
    exec(
      `${params.runtimeSetCommand} && npm install`,
      {
        cwd: params.servicePath,
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

  linkNodePackage(params);

  return true;
};

const setupPythonSDKService = async (
  params: Extract<AppConfig['services'][number], { module: 'python' }> & {
    servicePath: string;
    force?: boolean;
    srcPath: string;
    appConfig: AppConfig;
    runtimeSetCommand: string;
  },
) => {
  await generateSDKService({
    ...params,
    type: 'backend',
    framework: params.config?.framework || DEFAULT_PYTHON_BACKEND_FRAMEWORK,
  });

  writePythonSDKServiceConfig({ ...params, servicePath: params.servicePath });

  console.log(`Installing dependencies for "${params.servicePath}"`);

  await new Promise<void>((resolve, reject) => {
    exec(
      `${params.runtimeSetCommand} && source .venv/bin/activate`,
      {
        cwd: params.servicePath,
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
      `${params.runtimeSetCommand} && pip install -r requirements.txt`,
      {
        cwd: params.servicePath,
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

  await linkPythonPackage(params);

  return true;
};

const setupWebJSService = async (
  params: Extract<AppConfig['services'][number], { module: 'web-js' }> & {
    servicePath: string;
    force?: boolean;
    srcPath: string;
    appConfig: AppConfig;
    runtimeSetCommand: string;
  },
) => {
  if (!params.config?.framework) {
    throw new Error('framework is required for web-js service');
  }

  await generateSDKService({
    ...params,
    type: 'frontend',
    // @ts-ignore // todo add support for fullstack frameworks
    framework: params.config?.framework,
  });

  console.log(`Installing dependencies for "${params.servicePath}"`);
  await new Promise<void>((resolve, reject) => {
    exec(
      `${params.runtimeSetCommand} && npm install`,
      {
        cwd: params.servicePath,
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

  linkNodePackage(params);

  return true;
};

const setupCoreService = async (
  params: Extract<AppConfig['services'][number], { module: 'core' }> & {
    servicePath: string;
    force?: boolean;
    srcPath: string;
    appConfig: AppConfig;
    runtimeSetCommand: string;
  },
) => {
  // nothing to be setup here. since the service is actually the core package itself, we just return the srcPath
  // the java version is not changeable at the moment, so we don't need to return the runtimeSetCommand

  if (!fs.existsSync(params.servicePath)) {
    fs.mkdirSync(params.servicePath, { recursive: true });
  }

  const coreConfig = `
core_config_version: 0
disable_telemetry: true
port: ${params.port}
`;
  fs.writeFileSync(path.join(params.servicePath, 'config.yaml'), coreConfig);

  fs.cpSync(path.join(params.servicePath, 'config.yaml'), path.join(params.srcPath, 'devConfig.yaml'), {
    recursive: true,
  });

  return true;
};

export const setupService = async (
  service: AppConfig['services'][number] & {
    servicePath: string;
    force?: boolean;
    srcPath: string;
    appConfig: AppConfig;
    runtimeSetCommand: string;
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
  } else if (service.module === 'core') {
    return setupCoreService(service);
  } else {
    throw new Error(`Unsupported service module: ${service.module}`);
  }
};
