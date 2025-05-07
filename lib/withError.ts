export const withError = async (fn: () => Promise<any>) => {
  try {
    await fn();
  } catch (error) {
    console.log();

    if (error instanceof Error) {
      console.error(error.name, error.message);
    } else {
      console.error(error);
    }

    process.exit(1);
  }
};
