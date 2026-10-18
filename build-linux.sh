#!/bin/bash

# Builds Parallax Pool into ./build (or the directory passed as $1).
# Requires the .NET 10 SDK, make and a C/C++ compiler (g++).

set -e

BUILDDIR=$(realpath -m "${1:-build}")

echo "Building into $BUILDDIR"
(cd src/Miningcore && dotnet publish -c Release -o "$BUILDDIR")
