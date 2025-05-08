FROM debian:12-slim

RUN apt-get update  \
    && apt-get install build-essential -y \
    && apt-get -y --no-install-recommends install  \
    # install any other dependencies you might need
    git-core gpg wget curl unzip jq curl ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV MISE_DATA_DIR="/mise"
ENV MISE_CONFIG_DIR="/mise"
ENV MISE_CACHE_DIR="/mise/cache"
ENV MISE_INSTALL_PATH="/usr/local/bin/mise"
ENV PATH="/mise/shims:$PATH"
# ENV MISE_VERSION="..."

RUN curl https://mise.run | sh
RUN mise --version
RUN mise use -g node@20

WORKDIR /supertokens-root
COPY ./ .

RUN rm -rf node_modules
RUN rm -rf .git
RUN rm -rf .tmp
RUN rm -rf packages
RUN rm -rf mise.toml
RUN npm install
RUN npm run load

CMD ["npm run start"]