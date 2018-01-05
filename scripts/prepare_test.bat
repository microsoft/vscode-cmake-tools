cd test\fakeOutputGenerator
mkdir build
cd build
cmake ..
cmake --build .

mkdir ..\..\fakebin
copy ..\configfiles\* ..\..\fakebin

copy Debug\FakeOutputGenerator.exe ..\..\fakebin\clang-0.25.exe
copy Debug\FakeOutputGenerator.exe ..\..\fakebin\gcc-42.1.exe
copy Debug\FakeOutputGenerator.exe ..\..\fakebin\gcc-666.exe

cd ..\..\..