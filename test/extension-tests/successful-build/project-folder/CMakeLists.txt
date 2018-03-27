cmake_minimum_required(VERSION 3.0.0)
project(TestBuildProcess VERSION 0.1.0)

add_executable(TestBuildProcess main.cpp)
set_property(TARGET TestBuildProcess PROPERTY CXX_STANDARD 98)

add_custom_command(
    TARGET TestBuildProcess
    POST_BUILD
    COMMAND $<TARGET_FILE:TestBuildProcess> > output.txt
    WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
    COMMENT "Running in ${CMAKE_CURRENT_BINARY_DIR}"
)

set(configureEnvironment "$ENV{_CONFIGURE_ENV}" CACHE STRING "configureEnvironment")
set(buildEnvironment "$ENV{_BUILD_ENV}" CACHE STRING "buildEnvironment")
set(environment "$ENV{_ENV}" CACHE STRING "environment")

set(variantEnv "$ENV{TEST_VARIANT_ENV}" CACHE STRING "variantEnv")

add_definitions(
    -D_CMAKE_VERSION="${CMAKE_MAJOR_VERSION}.${CMAKE_MINOR_VERSION}"
    -D_GENERATOR="${CMAKE_GENERATOR}"
    -D_CRT_SECURE_NO_WARNINGS
)
