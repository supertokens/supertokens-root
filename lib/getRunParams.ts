export const getRunParams = () => {
  const [configPath, script, ...flags] = process.argv.slice(2);

  if (!configPath) {
    throw new Error('App config path is required');
  }

  if (!script) {
    throw new Error('Script name is required');
  }

  const validFlags = flags.every((flag) => flag.startsWith('--'));
  if (!validFlags) {
    throw new Error('All flags must start with --');
  }

  const force = flags.includes('--force');

  return {
    configPath,
    script,
    force,
    flags: flags,
  };
};
