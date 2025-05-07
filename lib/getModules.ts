import fs from 'fs';

export const getModules = (path: string = 'modules.txt'): { name: string; branch: string }[] => {
  const moduleFileContent = fs.readFileSync(path, 'utf8');

  return moduleFileContent
    .split('\n')
    .filter((line: string) => line.trim() && !line.startsWith('//'))
    .map((line: string) => {
      const [name, branch] = line.split(',');
      return {
        name,
        branch,
      };
    });
};
