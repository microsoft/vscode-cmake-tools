cmake_minimum_required(VERSION 3.20)

# Issue #4508: project() keywords should all get same color
project(
  MyProject
  VERSION "1.0.0"
  DESCRIPTION "A test project"
  HOMEPAGE_URL "https://example.com"
  LANGUAGES C CXX
)

# Issue #4709: project() with CMake 3.29+ keywords
project(
  NewProject
  VERSION "${NewProject_VERSION}"
  COMPAT_VERSION "1.2.3.4"
  SPDX_LICENSE "MIT"
  DESCRIPTION "Project description"
  HOMEPAGE_URL "https://www.example.com"
  LANGUAGES C CXX
)

# Issue #4709: CMAKE_C_STANDARD should be highlighted as built-in variable
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED TRUE)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED TRUE)

# Issue #4613: SOURCE_FILES should NOT be highlighted as deprecated
set(SOURCE_FILES main.cpp util.cpp)
set(TEST_FILES test1.cpp test2.cpp)
file(GLOB CPP_FILES *.cpp)
file(GLOB H_FILES *.h)
set(SOURCE_FILES ${CPP_FILES} ${H_FILES})
add_executable(MyApp ${SOURCE_FILES})

# Issue #4508: if() operators should all get same color
if(A AND B OR C)
  message(STATUS "test")
endif()

# Nested parentheses in if()
if((NOT EXISTS "${folder}") OR (NOT IS_DIRECTORY "${folder}"))
  message(WARNING "Folder not found")
endif()

# if() with version comparisons
if(${CMAKE_VERSION} VERSION_GREATER_EQUAL "3.20")
  message(STATUS "CMake 3.20+")
endif()

if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  message(STATUS "Linux")
elseif(CMAKE_SYSTEM_NAME STREQUAL "Windows")
  message(STATUS "Windows")
endif()

# Issue #4508: list() sub-commands should all get same color
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
list(POP_BACK my_list last_element)
list(POP_FRONT my_list first_element)
list(PREPEND my_list "first")
list(REMOVE_ITEM my_list "bad_item")
list(REMOVE_AT my_list 0)
list(REMOVE_DUPLICATES my_list)
list(REVERSE my_list)
list(SORT my_list)
list(FIND my_list "item" idx)
list(LENGTH my_list len)
list(SUBLIST my_list 0 3 sub)
list(JOIN my_list "," joined)
list(FILTER my_list INCLUDE REGEX "^test")
list(TRANSFORM my_list TOLOWER)

# Issue #4508: string() sub-commands should all get same color
string(TOLOWER "${var}" lower_var)
string(TOUPPER "${var}" upper_var)
string(REPLACE "old" "new" result "${input}")
string(REGEX MATCH "[0-9]+" match "${input}")
string(REGEX MATCHALL "[0-9]+" matches "${input}")
string(REGEX REPLACE "[0-9]+" "X" result "${input}")
string(FIND "${input}" "needle" pos)
string(LENGTH "${input}" len)
string(SUBSTRING "${input}" 0 5 sub)
string(STRIP "${input}" stripped)
string(APPEND result "more text")
string(PREPEND result "prefix")
string(JOIN "," result "a" "b" "c")
string(ASCII 72 101 108 108 111 greeting)
string(HEX "hello" hex_result)
string(CONFIGURE "input" output)
string(MAKE_C_IDENTIFIER "my-var" c_id)
string(RANDOM LENGTH 10 rand_str)
string(TIMESTAMP now "%Y-%m-%d")
string(UUID uuid NAMESPACE "6ba7b810-9dad-11d1-80b4-00c04fd430c8" NAME "test" TYPE SHA1)
string(JSON json_val GET "${json}" "key")
string(COMPARE EQUAL "a" "b" result)

# Issue #4508: message() log levels should all get same scope
message(STATUS "Info message")
message(WARNING "Warning message")
message(FATAL_ERROR "Fatal error")
message(SEND_ERROR "Send error")
message(AUTHOR_WARNING "Author warning")
message(DEPRECATION "Deprecated feature")
message(NOTICE "Notice")
message(VERBOSE "Verbose")
message(DEBUG "Debug")
message(TRACE "Trace")
message(CHECK_START "Checking...")
message(CHECK_PASS "found")
message(CHECK_FAIL "not found")

# set() with CACHE keywords
set(MY_VAR "value" CACHE STRING "A variable")
set(MY_BOOL ON CACHE BOOL "A boolean")
set(MY_PATH "/usr/local" CACHE PATH "A path")
set(MY_FILE "/usr/local/lib/libfoo.so" CACHE FILEPATH "A file")
set(MY_INTERNAL "hidden" CACHE INTERNAL "Internal var")
set(MY_VAR "override" CACHE STRING "overridden" FORCE)
set(MY_SCOPED "value" PARENT_SCOPE)

# option() — ON should be highlighted as boolean, not function
option(BUILD_TESTS "Build tests" ON)
option(BUILD_EXAMPLES "Build examples" OFF)
option(USE_FEATURE "Enable feature" YES)

# install() keywords
install(TARGETS MyApp
  RUNTIME DESTINATION bin
  LIBRARY DESTINATION lib
  ARCHIVE DESTINATION lib
  INCLUDES DESTINATION include
  COMPONENT main
)
install(FILES README.md LICENSE DESTINATION share/doc)
install(DIRECTORY include/ DESTINATION include)
install(EXPORT MyAppTargets NAMESPACE MyApp:: DESTINATION lib/cmake/MyApp)

# FetchContent_Declare — 'on'/'off' should be boolean
include(FetchContent)
FetchContent_Declare(
  cmake_test
  GIT_REPOSITORY https://github.com/example/test.git
  GIT_SHALLOW on
  GIT_PROGRESS on
  EXCLUDE_FROM_ALL
  SYSTEM
  DOWNLOAD_NO_PROGRESS off
  LOG_DOWNLOAD on
  LOG_UPDATE on
  LOG_PATCH on
  LOG_CONFIGURE on
  LOG_BUILD on
  LOG_INSTALL on
  LOG_TEST on
  LOG_MERGED_STDOUTERR on
  LOG_OUTPUT_ON_FAILURE on
  USES_TERMINAL_DOWNLOAD on
)

# User-defined function calls
function(my_custom_function arg1 arg2)
  message(STATUS "Custom function: ${arg1} ${arg2}")
endfunction()
my_custom_function(hello world)

# foreach() with keywords
foreach(item IN LISTS my_list)
  message(STATUS "${item}")
endforeach()

foreach(i RANGE 0 10)
  message(STATUS "${i}")
endforeach()

foreach(a b IN ZIP_LISTS list_a list_b)
  message(STATUS "${a} ${b}")
endforeach()

foreach(item IN ITEMS "a" "b" "c")
  message(STATUS "${item}")
endforeach()

# while() with operators
while(NOT done)
  # do something
endwhile()

# Variables that should be highlighted
set(val ${CMAKE_CURRENT_SOURCE_DIR})
set(val ${CMAKE_BINARY_DIR})
set(val $ENV{PATH})
set(val $CACHE{MY_VAR})

# Boolean values in various contexts
set(my_flag TRUE)
set(my_flag FALSE)
set(my_flag ON)
set(my_flag OFF)
set(my_flag YES)
set(my_flag NO)

# Block and endblock
block()
  set(local_var "value")
endblock()

# Generator expressions (simple, nested, multi-token)
target_compile_definitions(MyApp PRIVATE $<$<CONFIG:Debug>:DEBUG_MODE>)
target_link_libraries(MyApp PRIVATE $<$<AND:$<BOOL:${USE_SSL}>,$<NOT:$<PLATFORM_ID:Windows>>>:ssl>)
target_include_directories(MyApp PRIVATE $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>)
set(genex_var "$<TARGET_FILE:MyApp>")
target_compile_options(MyApp PRIVATE $<$<COMPILE_LANGUAGE:CXX>:-Wall -Wextra>)

# Comments
# This is a line comment
#[[
  This is a bracket comment
]]

# Module commands: FindPackageHandleStandardArgs
include(FindPackageHandleStandardArgs)
find_package_handle_standard_args(
  Foo
  REQUIRED_VARS Foo_LIBRARY Foo_INCLUDE_DIR
  VERSION_VAR Foo_VERSION
  HANDLE_VERSION_RANGE
  HANDLE_COMPONENTS
  REASON_FAILURE_MESSAGE "Could not find Foo"
)
find_package_handle_standard_args(Bar DEFAULT_MSG BAR_LIBRARY BAR_INCLUDE_DIR)
find_package_check_version(1.2.3 result HANDLE_VERSION_RANGE RESULT_MESSAGE_VARIABLE reason)

# Module commands: FetchContent
include(FetchContent)
FetchContent_Declare(
  googletest
  GIT_REPOSITORY https://github.com/google/googletest.git
  GIT_TAG        703bd9caab50b139428cea1aaff9974ebee5742e
  GIT_SHALLOW    TRUE
  FIND_PACKAGE_ARGS NAMES GTest
)
FetchContent_Declare(
  mylib
  URL      https://example.com/mylib-1.0.tar.gz
  URL_HASH MD5=d41d8cd98f00b204e9800998ecf8427e
  DOWNLOAD_NO_EXTRACT FALSE
  OVERRIDE_FIND_PACKAGE
  SYSTEM
  EXCLUDE_FROM_ALL
)
FetchContent_MakeAvailable(googletest mylib)
FetchContent_GetProperties(googletest SOURCE_DIR src BINARY_DIR bin POPULATED done)

# Module commands: ExternalProject
include(ExternalProject)
ExternalProject_Add(foobar
  GIT_REPOSITORY    git@github.com:FooCo/FooBar.git
  GIT_TAG           origin/release/1.2.3
  PREFIX            ${CMAKE_BINARY_DIR}/external
  CMAKE_ARGS        -DCMAKE_INSTALL_PREFIX=<INSTALL_DIR>
  CMAKE_CACHE_ARGS  -DBUILD_TESTS:BOOL=OFF
  BUILD_ALWAYS      TRUE
  INSTALL_COMMAND   ""
  TEST_BEFORE_INSTALL TRUE
  LOG_DOWNLOAD      TRUE
  LOG_BUILD         TRUE
  USES_TERMINAL_BUILD TRUE
  DEPENDS           some_other_target
  STEP_TARGETS      build install
)
ExternalProject_Add_Step(foobar docs
  COMMAND           <SOURCE_DIR>/makedoc <BINARY_DIR>
  WORKING_DIRECTORY <SOURCE_DIR>
  COMMENT           "Building foobar docs"
  DEPENDEES         build
  ALWAYS            TRUE
  EXCLUDE_FROM_MAIN TRUE
)

# Return
function(early_return)
  if(TRUE)
    return()
  endif()
endfunction()

# Macro
macro(my_macro ARG)
  message(STATUS "Macro: ${ARG}")
endmacro()