#!/bin/sh

current_dir=$(pwd)
cd test/fakeOutputGenerator

mkdir build
cd build
cmake ..
cmake --build .

mkdir ../../fakebin
cp ../configfiles/* ../../fakebin

cp FakeOutputGenerator ../../fakebin/clang-0.25
cp FakeOutputGenerator ../../fakebin/gcc-666
cp FakeOutputGenerator ../../fakebin/gcc-42.1

cd $current_dir
