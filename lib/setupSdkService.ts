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

export const generateSDKService = async (
  params: (
    | { type: 'backend'; framework: 'express' | 'fastify' | 'fastapi' | 'flask' | 'django' }
    | { type: 'frontend'; framework: 'react' }
  ) & {
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

  console.log(`Creating SDK service at "${params.outputPath}"`);
  const appDir = await createExampleApp({
    frontendFramework,
    backendFramework,
    firstFactors: params.appConfig.template.firstFactors,
    secondFactors: params.appConfig.template.secondFactors,
    providers: params.appConfig.template.providers,
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

const setupNodeSDKService = async (params: {
  servicePath?: string;
  outputPath: string;
  force?: boolean;
  runtimeVersion: string;
  srcPath: string;
  id: string;
  config?: {
    framework?: 'express' | 'fastify';
  };
  appConfig: AppConfig;
}) => {
  const servicePath =
    params.servicePath ||
    (await generateSDKService({
      ...params,
      type: 'backend',
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

  // create run script
  const runScript = `#!/bin/bash\n${runtimeSetCommand} && npm run start`;
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

const setupReactSDKService = async (params: {
  servicePath?: string;
  outputPath: string;
  force?: boolean;
  runtimeVersion: string;
  srcPath: string;
  appConfig: AppConfig;
  id: string;
}) => {
  const servicePath =
    params.servicePath ||
    (await generateSDKService({
      ...params,
      type: 'frontend',
      // todo add support for other frameworks
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

  // create run script
  const runScript = `#!/bin/bash\n${runtimeSetCommand} && npm run start`;
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

  linkNodePackage({ srcPath: params.srcPath, servicePath, runtimeSetCommand });

  const webJsService = params.appConfig.services.find((service) => service.module === 'web-js');
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
        runtimeSetCommand,
      });

      linkNodePackage({
        srcPath: path.join(BASE_DIR, webJsService.srcPath),
        servicePath: path.join(servicePath, 'node_modules', 'supertokens-auth-react'),
        runtimeSetCommand,
      });
    }
  }

  return servicePath;
};

const setupPythonSDKService = async (params: {
  servicePath?: string;
  outputPath: string;
  force?: boolean;
  runtimeVersion: string;
  srcPath: string;
  appConfig: AppConfig;
  id: string;
  config?: {
    framework?: 'flask' | 'django';
  };
}) => {
  const servicePath =
    params.servicePath ||
    (await generateSDKService({
      ...params,
      type: 'backend',
      framework: params.config?.framework || DEFAULT_PYTHON_BACKEND_FRAMEWORK,
    }));

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

  if (params.config?.framework === 'django') {
    const runScript = `#!/bin/bash\n${runtimeSetCommand} && python manage.py runserver`;
    fs.writeFileSync(path.join(servicePath, 'run'), runScript);
  } else {
    const runScript = `#!/bin/bash\n${runtimeSetCommand} && python app.py`;
    fs.writeFileSync(path.join(servicePath, 'run'), runScript);
  }

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
  } else {
  }
};
