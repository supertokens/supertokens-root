import { exec } from 'child_process';

const setNodeRuntimeVersion = async ({
  servicePath,
  runtimeVersion,
}: {
  servicePath: string;
  runtimeVersion: string;
}): Promise<boolean> => {
  console.log(`Setting Node.js version to ${runtimeVersion} in "${servicePath}"`);

  // Check if nvm exists and use it to set Node version and install dependencies
  await new Promise<void>((resolve, reject) => {
    exec('source ~/.nvm/nvm.sh && command -v nvm', (error: Error | null) => {
      if (error) {
        reject(new Error('nvm is not installed. Please install nvm first.'));
        return;
      }
      resolve();
    });
  });

  // Ensure the version exists, install if needed
  await new Promise<void>((resolve, reject) => {
    exec(`source ~/.nvm/nvm.sh && nvm install ${runtimeVersion}`, (error: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  // Use the version and install deps
  await new Promise<void>((resolve, reject) => {
    exec(`source ~/.nvm/nvm.sh && nvm use ${runtimeVersion}`, (error: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return true;
};

export const setRuntimeVersion = async ({
  runtime,
  runtimeVersion,
  servicePath,
}: {
  runtime: string;
  runtimeVersion: string;
  servicePath: string;
}): Promise<boolean> => {
  if (runtime === 'node') {
    return await setNodeRuntimeVersion({ servicePath, runtimeVersion });
  } else {
    throw new Error(`Unsupported runtime: ${runtime}`);
  }
};
