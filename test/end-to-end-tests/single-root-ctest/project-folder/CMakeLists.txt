cmake_minimum_required(VERSION 3.0.0)
project(TestCTestProcess VERSION 0.1.0)

add_executable(ConcatTestOutput main.cpp)
set_target_properties(ConcatTestOutput PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
add_executable(TestA test_a.cpp)
add_executable(TestB test_b.cpp)

enable_testing()

add_test(NAME "Suite1.TestA" COMMAND TestA)
add_test(NAME "Suite2.TestB" COMMAND TestB)
add_test(NAME "Concatenate_Test_Output" COMMAND ConcatTestOutput)

set_tests_properties("Concatenate_Test_Output" PROPERTIES FIXTURES_CLEANUP GENOUT)
set_tests_properties("Suite1.TestA" PROPERTIES FIXTURES_REQUIRED GENOUT)
set_tests_properties("Suite2.TestB" PROPERTIES FIXTURES_REQUIRED GENOUT)
