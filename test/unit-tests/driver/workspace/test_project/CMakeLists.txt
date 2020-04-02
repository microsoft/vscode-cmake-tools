cmake_minimum_required(VERSION 3.0.0)
project(TestBuildProcess VERSION 0.1.0)

set(CMT_COOKIE passed-cookie CACHE STRING "Cookie to be written by the main executable")

add_subdirectory(static_lib_dummy)
add_subdirectory(shared_lib_dummy)

add_executable(TestBuildProcess main.cpp)
set_property(TARGET TestBuildProcess PROPERTY CXX_STANDARD 98)

add_executable(TestBuildProcessOtherOutputDir main.cpp)
set_property(TARGET TestBuildProcessOtherOutputDir PROPERTY CXX_STANDARD 98)

set_target_properties( TestBuildProcessOtherOutputDir
    PROPERTIES
    ARCHIVE_OUTPUT_DIRECTORY "${PROJECT_SOURCE_DIR}/lib"
    LIBRARY_OUTPUT_DIRECTORY "${PROJECT_SOURCE_DIR}/lib"
    RUNTIME_OUTPUT_DIRECTORY "${PROJECT_SOURCE_DIR}/bin"
)
target_compile_definitions(TestBuildProcessOtherOutputDir PRIVATE
    "CMT_COOKIE=\"${CMT_COOKIE}\""
    "C_COMPILER_ID=\"${CMAKE_C_COMPILER_ID}\""
)
target_link_libraries(TestBuildProcessOtherOutputDir StaticLibDummy)

add_custom_command(
    TARGET TestBuildProcess
    POST_BUILD
    COMMAND $<TARGET_FILE:TestBuildProcess> > output.txt
    WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
    COMMENT "Running in ${CMAKE_CURRENT_BINARY_DIR}"
)


set(extraArgsEnvironment "${EXTRA_ARGS_TEST}" CACHE STRING "environment")
set(configureEnvironment "$ENV{_CONFIGURE_ENV}" CACHE STRING "configureEnvironment")
set(buildEnvironment "$ENV{_BUILD_ENV}" CACHE STRING "buildEnvironment")
set(environment "$ENV{_ENV}" CACHE STRING "environment")

set(variantEnv "$ENV{TEST_VARIANT_ENV}" CACHE STRING "variantEnv")

add_definitions(
    -D_CMAKE_VERSION="${CMAKE_MAJOR_VERSION}.${CMAKE_MINOR_VERSION}"
    -D_GENERATOR="${CMAKE_GENERATOR}"
    -D_CRT_SECURE_NO_WARNINGS
)

target_compile_definitions(TestBuildProcess PRIVATE
    "CMT_COOKIE=\"${CMT_COOKIE}\""
    "C_COMPILER_ID=\"${CMAKE_C_COMPILER_ID}\""
)
target_link_libraries(TestBuildProcess StaticLibDummy)

add_custom_target(runTestTarget DEPENDS TestBuildProcess
    COMMAND $<TARGET_FILE:TestBuildProcess> > output_target.txt
    WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
    COMMENT "Run test target"
)

# Test stop of process
# Therefor we delay the build process
if(DEFINED DELAY_BUILD)
if(WIN32)
add_custom_command(
    TARGET TestBuildProcess
    POST_BUILD
    COMMAND ping -n 30 127.0.0.1
)
endif (WIN32)

if(UNIX)
add_custom_command(
    TARGET TestBuildProcess
    POST_BUILD
    COMMAND ping -c 30 127.0.0.1
)
endif(UNIX)
endif (DEFINED DELAY_BUILD)