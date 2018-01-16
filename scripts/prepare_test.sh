#!/bin/bash
pushd .

# Location of the fake bin directory where the compiler fakes should be placed
PATH_TO_FAKEBIN=../../fakebin

cd test/fakeOutputGenerator

# Build Fake Compilers
mkdir build
cd build
cmake ..
cmake --build .

# Create fake bin directory with configured compilers
mkdir $PATH_TO_FAKEBIN
cp ../configfiles/* $PATH_TO_FAKEBIN

cp FakeOutputGenerator $PATH_TO_FAKEBIN/clang-0.25
cp FakeOutputGenerator $PATH_TO_FAKEBIN/gcc-666
cp FakeOutputGenerator $PATH_TO_FAKEBIN/gcc-42.1

popd
