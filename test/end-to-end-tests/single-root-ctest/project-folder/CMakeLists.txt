cmake_minimum_required(VERSION 3.6.0)
project(TestCTestProcess VERSION 0.1.0)

add_executable(GenerateOutputFile generate_output_file.cpp)
set_target_properties(GenerateOutputFile PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)

add_library(TestUtils)
target_sources(TestUtils PRIVATE test_utils.cpp)
target_include_directories(TestUtils PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
set_target_properties(TestUtils PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)

enable_testing()

add_test(NAME "Generate_Output_File" COMMAND GenerateOutputFile)
set_tests_properties("Generate_Output_File" PROPERTIES FIXTURES_CLEANUP GENOUT)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_SOURCE_DIR}/cmake")
include(RegisterTest)

set(TESTS_OUTPUT_FILES "/tmp/test_a.txt;/tmp/test_b.txt")
set(TESTS_NAMES "Suite1.TestA;Suite2.TestB")
set(TESTS_SUCCESS "true;true")

register_tests(TEST_NAME_LIST ${TESTS_NAMES} TEST_OUTPUT_FILE_PATH_LIST ${TESTS_OUTPUT_FILES} TEST_SUCCESS_LIST ${TESTS_SUCCESS})
