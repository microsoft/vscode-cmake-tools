#!/bin/sh -l

python -m pip install dinghy
dinghy https://github.com/microsoft/vscode-cmake-tools
cp digest.html /github/workspace/digest.html