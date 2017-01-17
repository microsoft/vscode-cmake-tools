cmake_minimum_required(VERSION 3.1)
project(TestProject)

include(CMakeToolsHelpers OPTIONAL)

add_executable(MyExecutable main.cpp another.cpp)

include(CTest)
enable_testing()
set(CTEST_BINARY_DIRECTORY "${CMAKE_BINARY_DIR}")

if(DEFINED WARNING_COOKIE)
    message(WARNING "${WARNING_COOKIE}")
endif()

add_test(AnExampleTest MyExecutable)

if(CAUSE_BUILD_ERROR)
    target_compile_definitions(MyExecutable PRIVATE CMT_DO_BUILD_ERROR)
endif()

if(MSVC)
    target_compile_definitions(MyExecutable PRIVATE _CRT_SECURE_NO_WARNINGS)
else()
    target_compile_options(MyExecutable PRIVATE -fprofile-arcs -ftest-coverage)
    target_link_libraries(MyExecutable PRIVATE --coverage)
endif()
