cmake_minimum_required(VERSION 3.0.0)
project(FakeOutputGenerator VERSION 0.1.0)

include(CTest)
enable_testing()

add_executable(FakeOutputGenerator main.cpp)
set_property(TARGET FakeOutputGenerator PROPERTY CXX_STANDARD 98)

set(CPACK_PROJECT_NAME ${PROJECT_NAME})
set(CPACK_PROJECT_VERSION ${PROJECT_VERSION})
include(CPack)
