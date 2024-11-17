cmake_minimum_required(VERSION 3.6.0)
project(TestCTestProcess VERSION 0.1.0)

add_executable(GenerateOutputFile generate_output_file.cpp)
set_target_properties(GenerateOutputFile PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
add_executable(TestA test_a.cpp)
add_executable(TestB test_b.cpp)

enable_testing()

add_test(NAME "Suite1.TestA" COMMAND TestA)
add_test(NAME "Suite2.TestB" COMMAND TestB)
add_test(NAME "Generate_Output_File" COMMAND GenerateOutputFile)

set_tests_properties("Generate_Output_File" PROPERTIES FIXTURES_CLEANUP GENOUT)
set_tests_properties("Suite1.TestA" PROPERTIES FIXTURES_REQUIRED GENOUT)
set_tests_properties("Suite2.TestB" PROPERTIES FIXTURES_REQUIRED GENOUT)
