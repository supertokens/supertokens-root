import { exec } from 'child_process';

const usedRuntimeManagers: {
  isUsingMise: boolean | undefined;
  isUsingNvm: boolean | undefined;
  isUsingAnaconda: boolean | undefined;
  isUsingVirtualenv: boolean | undefined;
} = {
  isUsingMise: undefined,
  isUsingNvm: undefined,
  isUsingAnaconda: undefined,
  isUsingVirtualenv: undefined,
};

const getRuntimeManagers = async () => {
  if (usedRuntimeManagers.isUsingMise === undefined) {
    usedRuntimeManagers.isUsingMise = await new Promise<boolean>((resolve, reject) => {
      exec('command -v mise', (error: Error | null) => {
        if (error) {
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  }

  if (usedRuntimeManagers.isUsingNvm === undefined) {
    usedRuntimeManagers.isUsingNvm = await new Promise<boolean>((resolve, reject) => {
      exec('command -v nvm', (error: Error | null) => {
        if (error) {
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  }

  if (usedRuntimeManagers.isUsingAnaconda === undefined) {
    usedRuntimeManagers.isUsingAnaconda = await new Promise<boolean>((resolve, reject) => {
      exec('command -v conda', (error: Error | null) => {
        if (error) {
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  }

  if (usedRuntimeManagers.isUsingVirtualenv === undefined) {
    usedRuntimeManagers.isUsingVirtualenv = await new Promise<boolean>((resolve, reject) => {
      exec('command -v virtualenv', (error: Error | null) => {
        if (error) {
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  }

  return usedRuntimeManagers;
};

const getNodeRuntimeSetCommand = async ({
  runtimeVersion,
}: {
  servicePath: string;
  runtimeVersion: string;
  id: string;
}): Promise<string> => {
  // Check if nvm exists and use it to set Node version and install dependencies
  const { isUsingMise, isUsingNvm } = await getRuntimeManagers();

  let command = '';
  if (isUsingMise) {
    // Ensure the version exists, install if needed and use it
    command = `mise trust && mise use node@${runtimeVersion}`;
  } else if (isUsingNvm) {
    command = `nvm install ${runtimeVersion} && nvm use ${runtimeVersion}`;
  } else {
    throw new Error('No compatible runtime manager found. Please install either mise or nvm first.');
  }

  return command;
};

const getPythonRuntimeSetCommand = async ({
  servicePath,
  runtimeVersion,
  id,
}: {
  servicePath: string;
  runtimeVersion: string;
  id: string;
}): Promise<string> => {
  // Check if python is installed
  const { isUsingAnaconda, isUsingMise } = await getRuntimeManagers();

  console.log(`Setting Python version to ${runtimeVersion} in "${servicePath}"`);

  let command = '';
  if (isUsingMise) {
    // Install python
    command = `mise trust && mise use python@${runtimeVersion} && python3 -m venv .venv`;
  } else if (isUsingAnaconda) {
    command = `conda create -n ${id} python=${runtimeVersion}`;
  } else {
    throw new Error('No compatible runtime manager found. Please install either mise or conda first.');
  }

  return command;
};

export const getRuntimeSetCommand = async ({
  runtime,
  runtimeVersion,
  servicePath,
  id,
}: {
  id: string;
  runtime: string;
  runtimeVersion: string;
  servicePath: string;
}): Promise<string> => {
  if (runtime === 'node') {
    return await getNodeRuntimeSetCommand({ servicePath, runtimeVersion, id });
  } else if (runtime === 'python') {
    return await getPythonRuntimeSetCommand({ servicePath, runtimeVersion, id });
  } else if (runtime === 'java') {
    return '';
  } else {
    throw new Error(`Unsupported runtime: ${runtime}`);
  }
};
