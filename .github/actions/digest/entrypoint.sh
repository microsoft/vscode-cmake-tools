#!/bin/sh -l

python -m pip install dinghy
export GITHUB_TOKEN=$1
dinghy https://github.com/microsoft/vscode-cmake-tools
