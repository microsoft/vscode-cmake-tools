#--------------------------------------------------------------------
# Generate the source file of the test in argument
# 
# Parameters:
#  output_file_path: path to the file, the test will write
#  test_success: true if the test end successfully. False otherwise.
# Returns:
#  test_source: name of the source file that will be generated
#--------------------------------------------------------------------
function(generate_test_source_file output_file_path test_success)
  get_filename_component(output_file_name ${output_file_path} NAME_WE)
  # Declare variables used in the template file (test.cpp.in)
  set(test_filename ${output_file_path})
  set(success ${test_success})
  # Generate test source file
  set(test_source "${output_file_name}.cpp")
  configure_file(test.cpp.in ${test_source} @ONLY)
  set(test_source "${test_source}" PARENT_SCOPE)
endfunction()

#--------------------------------------------------------------------
# Build the name of the test executable from the name of the test source file
#
# The name of the executable will be the one of the test source file without '_'
# and in CamelCase.
#
# Parameters:
#   test_source: name of the test source file
# Returns:
#   test_exe: name of the test executable
#--------------------------------------------------------------------
function(build_test_exe_name test_source)
  get_filename_component(test_name ${test_source} NAME_WE)
  # Replace _ with ; so that the name becomes a list of sub-words
  string(REPLACE "_" ";" splitted_test_name ${test_name})
  set(test_exe)
  # For each of the sub-word, extract the first letter
  # from the rest of the word (radical)
  foreach(word ${splitted_test_name})
    string(SUBSTRING ${word} 0 1 first_letter)
    string(SUBSTRING ${word} 1 -1 radical)
    # Turns first sub-word letter into upper case
    string(TOUPPER ${first_letter} up_first_letter)
    # Concat uppercase first letter and radical
    set(test_exe "${test_exe}${up_first_letter}${radical}")
  endforeach()
  # Returns test_exe
  set(test_exe ${test_exe} PARENT_SCOPE)
endfunction()

#--------------------------------------------------------------------
# Create and register a test
#
# Usage:
#   register_test(TEST_NAME <name> TEST_OUTPUT_FILE_PATH <path> TEST_SUCCESS <success>)
# Parameters:
#   TEST_NAME: name of the test
#   TEST_OUTPUT_FILE_PATH: path to the file the test should generate
#   TEST_SUCCESS: whether or not the test should end successfully
#--------------------------------------------------------------------
function(register_test)
  set(options)
  set(oneValueArgs "TEST_NAME;TEST_OUTPUT_FILE_PATH;TEST_SUCCESS")
  ### PARSING ARGUMENTS
  cmake_parse_arguments(register_test "${options}" "${oneValueArgs}" "${multiValueArgs}" ${ARGN})
  if(DEFINED register_test_KEYWORDS_MISSING_VALUES)
    message(
      FATAL_ERROR
        "In the call to register_test function, the keywords ${register_test_KEYWORDS_MISSING_VALUES} are awaiting for at least one value"
    )
  endif()
  if(DEFINED register_test_UNPARSED_ARGUMENTS)
    message(
      FATAL_ERROR
        "Following arguments are unknown to register_test function: ${register_test_UNPARSED_ARGUMENTS}"
    )
  endif()
  if(NOT DEFINED register_test_TEST_NAME)
    message(FATAL_ERROR "The function register_test is awaiting for TEST_NAME keyword")
  endif()
  if(NOT DEFINED register_test_TEST_OUTPUT_FILE_PATH)
    message(FATAL_ERROR "The function register_test is awaiting for TEST_OUTPUT_FILE_PATH keyword")
  endif()
  if(NOT DEFINED register_test_TEST_SUCCESS)
    message(FATAL_ERROR "The function register_test is awaiting for TEST_SUCCESS keyword")
  endif()

  message(STATUS "Creating test named ${register_test_TEST_NAME} with result stored in ${register_test_TEST_OUTPUT_FILE_PATH} returning as success: ${register_test_TEST_SUCCESS}")
  ### GENERATE TEST
  generate_test_source_file(${register_test_TEST_OUTPUT_FILE_PATH} ${register_test_TEST_SUCCESS}) # => returns test_source
  build_test_exe_name(${test_source}) # => returns test_exe
  message(STATUS "--> Creating test executable ${test_exe} with source ${test_source}")
  add_executable(${test_exe} ${test_source})
  target_link_libraries(${test_exe} PRIVATE TestUtils)
  add_test(NAME "${register_test_TEST_NAME}" COMMAND "${test_exe}")
  set_tests_properties("${register_test_TEST_NAME}" PROPERTIES FIXTURES_REQUIRED GENOUT)
endfunction()

#--------------------------------------------------------------------
# Create and register tests in arguments
#
# Usage:
#   register_tests(TEST_NAME_LIST <names> TEST_OUTPUT_FILE_PATH_LIST <paths> TEST_SUCCESS_LIST <successes>)
# Parameters:
#   TEST_NAME_LIST: name of the test
#   TEST_OUTPUT_FILE_PATH_LIST: path to the file the test should generate
#   TEST_SUCCESS_LIST: whether or not the test should end successfully
#--------------------------------------------------------------------
function(register_tests)
  set(options)
  set(multiValueArgs "TEST_NAME_LIST;TEST_OUTPUT_FILE_PATH_LIST;TEST_SUCCESS_LIST")
  ### PARSING ARGUMENTS
  cmake_parse_arguments(register_tests "${options}" "${oneValueArgs}" "${multiValueArgs}" ${ARGN})
  if(DEFINED register_tests_KEYWORDS_MISSING_VALUES)
    message(
      FATAL_ERROR
        "In the call to register_tests function, the keywords ${register_tests_KEYWORDS_MISSING_VALUES} are awaiting for at least one value"
    )
  endif()
  if(DEFINED register_tests_UNPARSED_ARGUMENTS)
    message(
      FATAL_ERROR
        "Following arguments are unknown to register_tests function: ${register_tests_UNPARSED_ARGUMENTS}"
    )
  endif()
  if(NOT DEFINED register_tests_TEST_NAME_LIST)
    message(FATAL_ERROR "The function register_tests is awaiting for TEST_NAME_LIST keyword")
  endif()
  if(NOT DEFINED register_tests_TEST_OUTPUT_FILE_PATH_LIST)
    message(FATAL_ERROR "The function register_tests is awaiting for TEST_OUTPUT_FILE_PATH_LIST keyword")
  endif()
  if(NOT DEFINED register_tests_TEST_SUCCESS_LIST)
    message(FATAL_ERROR "The function register_tests is awaiting for TEST_SUCCESS_LIST keyword")
  endif()

  list(LENGTH register_tests_TEST_NAME_LIST NB_TESTS)
  math(EXPR MAX_INDEX "${NB_TESTS}-1")
  foreach(test_index RANGE ${MAX_INDEX})
      list(GET register_tests_TEST_OUTPUT_FILE_PATH_LIST ${test_index} test_output)
      list(GET register_tests_TEST_NAME_LIST ${test_index} test_name)
      list(GET register_tests_TEST_SUCCESS_LIST ${test_index} test_success)
      register_test(TEST_NAME ${test_name} TEST_OUTPUT_FILE_PATH ${test_output} TEST_SUCCESS ${test_success})
  endforeach()
endfunction()