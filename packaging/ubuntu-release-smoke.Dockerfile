FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ARG NODE_VERSION=22.12.0
WORKDIR /src
COPY . /src

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates curl git build-essential pkg-config \
    golang-go \
    libgtk-3-dev libwebkit2gtk-4.1-dev \
    dpkg-dev desktop-file-utils shared-mime-info xdg-utils \
  && rm -rf /var/lib/apt/lists/*

RUN curl --fail --silent --show-error --location \
    "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    | tar -xJ --strip-components=1 -C /usr/local

RUN scripts/package-linux-release.sh

# Verify checksums, package metadata, install-time registration hooks, and
# removal. The package is not launched: GUI rendering and physical keyboards
# belong to host/CI acceptance tests rather than a headless container.
RUN (cd dist && sha256sum -c SHA256SUMS) \
  && dpkg-deb --info dist/keyboardeer_1.0.0_amd64.deb \
  && dpkg -i dist/keyboardeer_1.0.0_amd64.deb \
  && test -x /usr/bin/keyboardeer \
  && test -f /usr/share/applications/keyboardeer.desktop \
  && test -f /usr/share/mime/packages/keyboardeer-kbdprofile.xml \
  && dpkg -r keyboardeer \
  && test ! -e /usr/bin/keyboardeer
