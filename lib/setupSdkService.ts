import path from 'path';
import fs from 'fs';
import { createExampleApp } from './createExampleApp';
import { exec } from 'child_process';
import { AppConfig } from './validateAppConfig';
import {
  DEFAULT_FRONTEND_TARGET,
  DEFAULT_BACKEND_TARGET,
  FRONTEND_TARGETS,
  BACKEND_TARGETS,
  NODE_RUNTIME_TARGETS,
  ServiceTarget,
  PYTHON_RUNTIME_TARGETS,
  MODULE_TARGETS,
  BASE_PACKAGES_DIR,
  logger,
} from '../lib';
import { writePythonSDKServiceConfig } from './writeConfig';

export const generateSDKService = async (params: {
  id: string;
  target: ServiceTarget;
  host: string;
  port: number;
  config: { apiPort?: number; apiHost?: string; clientPort?: number; clientHost?: string; coreURI?: string };
  servicePath: string;
  force?: boolean;
  appConfig: AppConfig;
}) => {
  const log = logger(params.id);

  // doing it like this to preserve typing
  let frontendFramework = FRONTEND_TARGETS.find((target) => target === params.target);
  let backendFramework = BACKEND_TARGETS.find((target) => target === params.target);
  if (!frontendFramework && !backendFramework) {
    throw new Error(`Unsupported service target: ${params.target}`);
  }

  const type = frontendFramework ? 'frontend' : 'backend';

  if (!params.appConfig.template) {
    throw new Error('An SDK service can only be generated if the app config contains a template');
  }

  const clientPort = frontendFramework ? params.port : params.config?.clientPort;
  const apiPort = backendFramework ? params.port : params.config?.apiPort;
  if (!clientPort || !apiPort) {
    throw new Error('both clientPort and apiPort must be provided');
  }

  const clientHost = frontendFramework ? params.host : params.config?.clientHost;
  const apiHost = backendFramework ? params.host : params.config?.apiHost;
  if (!clientHost || !apiHost) {
    throw new Error('both clientHost and apiHost must be provided');
  }

  // set defaults so that the createExampleApp function can be called
  if (!frontendFramework) {
    frontendFramework = DEFAULT_FRONTEND_TARGET;
  }
  if (!backendFramework) {
    backendFramework = DEFAULT_BACKEND_TARGET;
  }

  log.info(`Creating SDK service at "${params.servicePath}"`);
  const appDir = await createExampleApp({
    frontendFramework,
    backendFramework,
    firstFactors: params.appConfig.template.firstFactors,
    secondFactors: params.appConfig.template.secondFactors,
    providers: params.appConfig.template.providers,
    ...params.config,
    clientPort,
    apiPort,
    clientHost,
    apiHost,
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

  const generatedServiceOutputPath = path.join(appDir, type);
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
  id,
  srcPath,
  servicePath,
  runtimeSetCommand,
  appConfig,
}: {
  id: string;
  srcPath: string;
  servicePath: string;
  runtimeSetCommand: string;
  appConfig: AppConfig;
}) => {
  const log = logger(id);

  const packageName = srcPath.split('/').pop()!;

  log.info(`Linking "${srcPath}" -> "${servicePath}"`);

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
  id,
  appConfig,
}: {
  srcPath: string;
  servicePath: string;
  runtimeSetCommand: string;
  id: string;
  appConfig: AppConfig;
}) => {
  const log = logger(id);

  log.info(`Linking "${srcPath}" -> "${servicePath}"`);

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

const setupNodeSDKService = async (params: {
  id: string;
  target: (typeof NODE_RUNTIME_TARGETS)[number];
  host: string;
  port: number;
  config: { apiPort?: number; apiHost?: string; clientPort?: number; clientHost?: string; coreURI?: string };
  force?: boolean;
  servicePath: string;
  appConfig: AppConfig;
  runtimeSetCommand: string;
  libs: string[];
}) => {
  const log = logger(params.id);

  const shouldInstallAndGenerate = params.force || !fs.existsSync(params.servicePath);
  if (shouldInstallAndGenerate) {
    await generateSDKService(params);

    log.info(`Installing dependencies`);

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
  }

  // this is done everytime, as there might be changes
  for (const lib of params.libs) {
    await linkNodePackage({
      ...params,
      srcPath: path.join(BASE_PACKAGES_DIR, lib),
    });
  }

  return true;
};

const setupPythonSDKService = async (params: {
  id: string;
  target: (typeof PYTHON_RUNTIME_TARGETS)[number];
  host: string;
  port: number;
  config: { clientPort?: number; clientHost?: string; coreURI?: string };
  force?: boolean;
  servicePath: string;
  appConfig: AppConfig;
  runtimeSetCommand: string;
  libs: string[];
}) => {
  const log = logger(params.id);
  const shouldInstallAndGenerate = params.force || !fs.existsSync(params.servicePath);
  if (shouldInstallAndGenerate) {
    await generateSDKService(params);

    log.info(`Installing dependencies`);

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
  }

  for (const lib of params.libs) {
    await linkPythonPackage({
      ...params,
      srcPath: path.join(BASE_PACKAGES_DIR, lib),
    });
  }

  return true;
};

const setupCoreService = async (params: {
  id: string;
  host: string;
  port: number;
  servicePath: string;
  force?: boolean;
  appConfig: AppConfig;
  runtimeSetCommand: string;
}) => {
  // nothing to be setup here. since the service is actually the core package itself, we just return the srcPath
  // the java version is not changeable at the moment, so we don't need to return the runtimeSetCommand

  if (!fs.existsSync(params.servicePath)) {
    fs.mkdirSync(params.servicePath, { recursive: true });
  }

  const coreConfig = `
core_config_version: 0
disable_telemetry: true
port: ${params.port}
host: ${params.host}
`;
  fs.writeFileSync(path.join(params.servicePath, 'config.yaml'), coreConfig);

  fs.cpSync(path.join(params.servicePath, 'config.yaml'), path.join(params.servicePath, 'devConfig.yaml'), {
    recursive: true,
  });

  return true;
};

export const setupTarget = async (service: {
  id: string;
  target: ServiceTarget;
  host: string;
  port: number;
  config: {
    apiPort?: number;
    apiHost?: string;
    clientPort?: number;
    clientHost?: string;
    corePort?: number;
    coreHost?: string;
    coreURI?: string;
  };
  libs: string[];
  servicePath: string;
  force?: boolean;
  appConfig: AppConfig;
  runtimeSetCommand: string;
}) => {
  if (NODE_RUNTIME_TARGETS.find((target) => target === service.target)) {
    return setupNodeSDKService({ ...service, target: service.target as (typeof NODE_RUNTIME_TARGETS)[number] });
  } else if (PYTHON_RUNTIME_TARGETS.find((target) => target === service.target)) {
    return setupPythonSDKService({ ...service, target: service.target as (typeof PYTHON_RUNTIME_TARGETS)[number] });
  } else if (service.target === ServiceTarget.SupertokensCore) {
    return setupCoreService(service);
  } else {
    console.warn(`Unsupported service target for "${service.id}": ${service.target}`);
  }
};
