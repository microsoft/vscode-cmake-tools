cmake_minimum_required(VERSION 3.5.0)
project(TestBuildProcess VERSION 0.1.0)

set(CMT_COOKIE passed-cookie CACHE STRING "Cookie to be written by the main executable")

option(USE_COVERAGE "Enable GCOV during the build" OFF)
if(USE_COVERAGE)
    add_compile_options(--coverage)
    add_link_options(--coverage)
endif()

include(CTest)

add_executable(TestBuildProcess main.cpp)
set_property(TARGET TestBuildProcess PROPERTY CXX_STANDARD 98)

add_test(NAME TestBuildProcessAsTest
    COMMAND $<TARGET_FILE:TestBuildProcess>)

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

target_compile_definitions(TestBuildProcess PRIVATE
    "CMT_COOKIE=\"${CMT_COOKIE}\""
    "C_COMPILER_ID=\"${CMAKE_C_COMPILER_ID}\""
)

add_custom_target(runTestTarget DEPENDS TestBuildProcess
    COMMAND $<TARGET_FILE:TestBuildProcess> > output_target.txt
    WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
    COMMENT "Run test target"
)

find_program(LCOV lcov REQUIRED)
set(LCOV_BASE lcov-base.info)
set(LCOV_TEST lcov-test.info)
set(LCOV_TOTAL lcov.info)
set(LCOV_LOG lcov.log)
set(LCOV_ERR lcov.err)
add_custom_target(init-coverage
    COMMENT "Collecting initial coverage"
    COMMAND lcov -c -i -d ${CMAKE_CURRENT_BINARY_DIR}
        -o ${LCOV_BASE} 2>${LCOV_ERR} >${LCOV_LOG})
add_dependencies(init-coverage reset-coverage)

add_custom_target(reset-coverage
    COMMENT "Reset all coverage counters to zero"
    COMMAND lcov -q -z -d ${CMAKE_CURRENT_BINARY_DIR}
        -o ${LCOV_BASE}
    COMMAND lcov -q -z -d ${CMAKE_CURRENT_BINARY_DIR}
        -o ${LCOV_TEST}
    COMMAND lcov -q -z -d ${CMAKE_CURRENT_BINARY_DIR}
        -o ${LCOV_TOTAL})

add_custom_target(capture-coverage
    COMMENT "Capture coverage data"
    DEPENDS ${LCOV_BASE}
    COMMAND lcov -c -d ${CMAKE_CURRENT_BINARY_DIR} -o ${LCOV_TEST}
        2>${LCOV_ERR} >${LCOV_LOG}
    COMMAND lcov -a ${LCOV_BASE} -a ${LCOV_TEST} -o ${LCOV_TOTAL}
        >>${LCOV_LOG}
    COMMAND lcov -r ${LCOV_TOTAL} -o ${LCOV_TOTAL} "'/usr/include*'"
        >>${LCOV_LOG})
