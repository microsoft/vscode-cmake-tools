#!/bin/sh

current_dir=$(pwd)
cd test/fakeOutputGenerator

mkdir build
cd build
cmake ..
cmake --build .

mkdir ../../fakebin
cp ../configfiles/* ../../fakebin

cp Debug/FakeOutputGenerator.exe ../../fakebin/clang-0.25.exe
cp Debug/FakeOutputGenerator.exe ../../fakebin/gcc-666.exe
cp Debug/FakeOutputGenerator.exe ../../fakebin/gcc-42.1.exe

cd $current_dir