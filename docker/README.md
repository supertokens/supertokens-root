## Docker image for testing

- the script `createPostgresqlImage.sh` here is used to create docker image with postgresql plugin.
- Before the user runs this script, they need to start the testing env (i.e. `./scripts/core/startTestEnv --wait`).
- This script can only be used for postgresql plugin. No other plugin is supported. So before running the script, make
  sure to switch to postgresql-plugin in the `./modules.txt`.

### What the script is doing?

- it fetches the required **jre** (based on your system architecture) and **docker-entrypoint.sh** from github.
- copies the required cli, core, plugin, etc. from the parent directory into this folder
- creates docker image with tag `supertokens-postgresql-testing`
- removes all the copied/fetched files and folders