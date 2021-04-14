#-------------------------------------------------------------------------------------------------------------
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See https://go.microsoft.com/fwlink/?linkid=2090316 for license information.
#-------------------------------------------------------------------------------------------------------------

# To fully customize the contents of this image, use the following Dockerfile instead:
# https://github.com/microsoft/vscode-dev-containers/tree/v0.128.0/containers/typescript-node-10/.devcontainer/Dockerfile
FROM mcr.microsoft.com/vscode/devcontainers/typescript-node:12

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        apt \
        curl \
        file \
        git \
        ninja-build \
        gcc \
        gdb \
        net-tools \
        xz-utils && \
    apt-get autoremove -y && \
    apt-get clean -y && \
    rm -rf /var/lib/apt/lists/*; \
    curl -L -O https://github.com/Kitware/CMake/releases/download/v3.20.1/cmake-3.20.1-linux-x86_64.tar.gz && \
    tar -xf cmake-3.20.1-linux-x86_64.tar.gz && \
    rm cmake-3.20.1-linux-x86_64.tar.gz;

ENV PATH "$PATH:/:/cmake-3.20.1-linux-x86_64/bin"
