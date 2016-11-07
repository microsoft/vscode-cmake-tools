cmake_minimum_required(VERSION 3.1)
project(TestProject)

include(CMakeToolsHelpers OPTIONAL)

add_executable(MyExecutable main.cpp)

include(CTest)
enable_testing()

add_test(AnExampleTest MyExecutable)