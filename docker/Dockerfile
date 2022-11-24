FROM ubuntu:bionic-20200219 as tmp
RUN mkdir supertokens
WORKDIR supertokens
COPY core core
COPY cli cli
COPY downloader downloader
COPY ee ee
COPY plugin-interface plugin-interface
COPY plugin plugin
COPY install ./
COPY config.yaml ./
COPY config.yaml config.yaml.original
COPY jre jre
COPY version.yaml ./
RUN ./install
FROM debian:stable-slim
RUN groupadd supertokens && useradd -m -s /bin/bash -g supertokens supertokens
RUN apt-get update && apt-get install -y --no-install-recommends gnupg dirmngr && rm -rf /var/lib/apt/lists/*
ENV GOSU_VERSION 1.7
RUN set -x \
	&& apt-get update && apt-get install -y --no-install-recommends ca-certificates wget && rm -rf /var/lib/apt/lists/* \
	&& wget -O /usr/local/bin/gosu "https://github.com/tianon/gosu/releases/download/$GOSU_VERSION/gosu-$(dpkg --print-architecture)" \
	&& wget -O /usr/local/bin/gosu.asc "https://github.com/tianon/gosu/releases/download/$GOSU_VERSION/gosu-$(dpkg --print-architecture).asc" \
	&& export GNUPGHOME="$(mktemp -d)" \
	&& gpg --batch --keyserver hkps://keys.openpgp.org --recv-keys B42F6819007F00F88E364FD4036A9C25BF357DD4 \
	&& gpg --batch --verify /usr/local/bin/gosu.asc /usr/local/bin/gosu \
	&& gpgconf --kill all \
	&& rm -rf "$GNUPGHOME" /usr/local/bin/gosu.asc \
	&& chmod +x /usr/local/bin/gosu \
	&& apt-get purge -y --auto-remove ca-certificates wget
COPY --from=tmp --chown=supertokens /usr/lib/supertokens /usr/lib/supertokens
COPY --from=tmp --chown=supertokens /usr/bin/supertokens /usr/bin/supertokens
COPY docker-entrypoint.sh /usr/local/bin/
RUN echo "$(md5sum /usr/lib/supertokens/config.yaml | awk '{ print $1 }')" >> /CONFIG_HASH
RUN ln -s usr/local/bin/docker-entrypoint.sh /entrypoint.sh # backwards compat
EXPOSE 3567
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["supertokens", "start"]
