pushd .
REM Location of the fake bin directory where the compiler fakes should be placed
set PATH_TO_FAKEBIN=..\..\fakebin

REM Build Fake Compilers
cd test\fakeOutputGenerator
mkdir build
cd build
cmake ..
cmake --build .

REM Create fake bin directory with configured compilers
mkdir %PATH_TO_FAKEBIN%
copy ..\configfiles\* %PATH_TO_FAKEBIN%

copy Debug\FakeOutputGenerator.exe %PATH_TO_FAKEBIN%\clang-0.25.exe
copy Debug\FakeOutputGenerator.exe %PATH_TO_FAKEBIN%\gcc-42.1.exe
copy Debug\FakeOutputGenerator.exe %PATH_TO_FAKEBIN%\gcc-666.exe

popd