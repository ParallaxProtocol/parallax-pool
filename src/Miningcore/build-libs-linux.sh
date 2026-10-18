#!/bin/bash

# Builds the native XHash library into the output directory given as $1.
#
# The library is compiled for a portable baseline of the target architecture so
# binaries (and Docker images) built on one machine run on any other machine of
# that architecture. Set CPU_FLAGS (e.g. CPU_FLAGS=-march=native) to tune for
# the build host instead.

set -e

OutDir=$1

export CPU_FLAGS="${CPU_FLAGS:-}"

(cd ../Native/libxhash && make clean && make) && mv ../Native/libxhash/libxhash.so "$OutDir"
