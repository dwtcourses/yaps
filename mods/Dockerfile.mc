FROM node:13-alpine
LABEL maintainer="Pedro Sanders <fonosterteam@fonoster.com>"

COPY . /mods
COPY etc/run-mc.sh /run.sh
RUN apk add --update sox python git make g++; \
  cd /mods ; \
  npm config set unsafe-perm true ; \
  npm install lerna -g; \
  npm run clean ; \
  lerna bootstrap ; \
  apk del python git make g++ ; \
  rm -rf /var/cache/apk/* ; \
  chmod +x /run.sh

CMD ["/bin/sh", "-c", "/run.sh"]
