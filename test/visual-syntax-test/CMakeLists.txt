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

# ============================================================================
# PR #4527 additions — knownVariables extensions
# ============================================================================

# Bare variable references (should highlight as support.type.variable.cmake)
${CMAKE_MSVC_RUNTIME_LIBRARY}
${CMAKE_INTERPROCEDURAL_OPTIMIZATION}
${CMAKE_UNITY_BUILD}
${CMAKE_UNITY_BUILD_BATCH_SIZE}
${CMAKE_UNITY_BUILD_MODE}
${CMAKE_COMPILE_WARNING_AS_ERROR}
${CMAKE_COLOR_DIAGNOSTICS}
${CMAKE_LINK_WHAT_YOU_USE}
${CMAKE_VERIFY_INTERFACE_HEADER_SETS}
${CMAKE_OPTIMIZE_DEPENDENCIES}
${CMAKE_BUILD_RPATH}
${CMAKE_BUILD_RPATH_USE_ORIGIN}
${CMAKE_CXX_COMPILER_VERSION}
${CMAKE_CXX_EXTENSIONS}
${CMAKE_CXX_STANDARD_REQUIRED}

# Variables used in set()/message() context
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
set(CMAKE_INTERPROCEDURAL_OPTIMIZATION TRUE)
set(CMAKE_UNITY_BUILD ON)
set(CMAKE_UNITY_BUILD_BATCH_SIZE 16)
set(CMAKE_UNITY_BUILD_MODE BATCH)
set(CMAKE_COMPILE_WARNING_AS_ERROR ON)
set(CMAKE_COLOR_DIAGNOSTICS ON)
set(CMAKE_LINK_WHAT_YOU_USE TRUE)
set(CMAKE_VERIFY_INTERFACE_HEADER_SETS ON)
set(CMAKE_OPTIMIZE_DEPENDENCIES TRUE)
set(CMAKE_BUILD_RPATH "/opt/lib")
set(CMAKE_BUILD_RPATH_USE_ORIGIN TRUE)

message(STATUS "CXX compiler version: ${CMAKE_CXX_COMPILER_VERSION}")
message(STATUS "CXX extensions: ${CMAKE_CXX_EXTENSIONS}")
message(STATUS "CXX standard required: ${CMAKE_CXX_STANDARD_REQUIRED}")

# Regex-generalized family coverage
message(STATUS "C compiler version: ${CMAKE_C_COMPILER_VERSION}")
message(STATUS "Fortran simulate ID: ${CMAKE_Fortran_SIMULATE_ID}")
message(STATUS "CXX frontend variant: ${CMAKE_CXX_COMPILER_FRONTEND_VARIANT}")
message(STATUS "C simulate version: ${CMAKE_C_SIMULATE_VERSION}")
message(STATUS "CXX compile features: ${CMAKE_CXX_COMPILE_FEATURES}")

# ============================================================================
# PR #4527 additions — scopedPropertyCommand coverage
# ============================================================================

# set_property with GLOBAL scope and property names
set_property(GLOBAL PROPERTY INTERPROCEDURAL_OPTIMIZATION TRUE)
set_property(GLOBAL PROPERTY POSITION_INDEPENDENT_CODE ON)
set_property(GLOBAL APPEND PROPERTY COMPILE_OPTIONS "-Wall")

# get_property with TARGET scope
get_property(result TARGET MyApp PROPERTY COMPILE_FEATURES)
get_property(result TARGET MyApp PROPERTY INTERFACE_LINK_LIBRARIES)

# set_target_properties with multiple properties
set_target_properties(MyApp PROPERTIES
  OUTPUT_NAME "myapp"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
  LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib"
  UNITY_BUILD ON
  UNITY_BUILD_MODE BATCH
  LINK_WHAT_YOU_USE TRUE
  VERIFY_INTERFACE_HEADER_SETS ON
  OPTIMIZE_DEPENDENCIES TRUE
  FOLDER "Apps"
  LINKER_LANGUAGE CXX
  VERSION "1.0.0"
  SOVERSION "1"
  INSTALL_RPATH "/opt/lib"
  INSTALL_RPATH_USE_LINK_PATH TRUE
  SKIP_BUILD_RPATH FALSE
  BUILD_WITH_INSTALL_RPATH FALSE
  AUTOMOC ON
  AUTOUIC ON
  AUTORCC ON
  MACOSX_BUNDLE TRUE
  MACOSX_RPATH TRUE
  WIN32_EXECUTABLE TRUE
  FRAMEWORK FALSE
  ENABLE_EXPORTS ON
)

# set_source_files_properties with SOURCE scope keywords
set_source_files_properties(main.cpp PROPERTIES
  GENERATED FALSE
  LANGUAGE CXX
  HEADER_FILE_ONLY FALSE
  COMPILE_FLAGS "-O2"
  COMPILE_DEFINITIONS "USE_FEATURE=1"
  OBJECT_DEPENDS "header.h"
  WRAP_EXCLUDE TRUE
  SYMBOLIC FALSE
)

# define_property with INHERITED
define_property(TARGET PROPERTY MY_CUSTOM_PROP
  BRIEF_DOCS "A custom property"
  FULL_DOCS "Full documentation for custom property"
  INHERITED
)

# get_directory_property
get_directory_property(dir_defs COMPILE_DEFINITIONS)
get_directory_property(dir_opts DIRECTORY "${CMAKE_SOURCE_DIR}" COMPILE_OPTIONS)

# set_tests_properties with test properties
set_tests_properties(my_test PROPERTIES
  TIMEOUT 120
  WILL_FAIL FALSE
  COST 10
  LABELS "unit;fast"
  PASS_REGULAR_EXPRESSION "PASSED"
  FAIL_REGULAR_EXPRESSION "FAILED"
  FIXTURES_REQUIRED "db_fixture"
  FIXTURES_SETUP "setup_fixture"
  FIXTURES_CLEANUP "cleanup_fixture"
  RESOURCE_LOCK "gpu"
  PROCESSORS 4
  RUN_SERIAL TRUE
  WORKING_DIRECTORY "${CMAKE_BINARY_DIR}"
)

# get_test_property
get_test_property(my_test TIMEOUT test_timeout)

# More property coverage: archive, PDB, import, compatibility, VS
set_target_properties(MyLib PROPERTIES
  ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib"
  ARCHIVE_OUTPUT_NAME "mylib"
  PDB_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/pdb"
  PDB_NAME "mylib"
  DEBUG_POSTFIX "d"
  IMPORT_PREFIX ""
  IMPORT_SUFFIX ".lib"
  IMPORTED TRUE
  DEFINE_SYMBOL "MYLIB_EXPORTS"
  STATIC_LIBRARY_FLAGS "/LTCG"
  COMPATIBLE_INTERFACE_BOOL "POSITION_INDEPENDENT_CODE"
  COMPATIBLE_INTERFACE_STRING "LINKER_LANGUAGE"
  NO_SONAME TRUE
  HAS_CXX TRUE
  GNUtoMS ON
  INTERFACE_COMPILE_DEFINITIONS "MYLIB_SHARED"
  INTERFACE_INCLUDE_DIRECTORIES "${CMAKE_CURRENT_SOURCE_DIR}/include"
  INTERFACE_LINK_LIBRARIES "dep_lib"
  INTERFACE_COMPILE_OPTIONS "-fPIC"
  INTERFACE_COMPILE_FEATURES "cxx_std_17"
  INTERFACE_SOURCES "extra.cpp"
  INTERFACE_SYSTEM_INCLUDE_DIRECTORIES "/usr/include"
  INTERFACE_POSITION_INDEPENDENT_CODE ON
  INTERFACE_HEADER_SETS "default"
  PRECOMPILE_HEADERS "<vector>;pch.h"
  HEADER_SETS "default"
  EXCLUDE_FROM_ALL TRUE
  INSTALL_NAME_DIR "/opt/lib"
  PREFIX "lib"
  SUFFIX ".so"
  OSX_ARCHITECTURES "arm64;x86_64"
  MACOSX_BUNDLE_INFO_PLIST "${CMAKE_SOURCE_DIR}/Info.plist"
  MACOSX_FRAMEWORK_INFO_PLIST "${CMAKE_SOURCE_DIR}/Framework.plist"
  MACOSX_PACKAGE_LOCATION "Resources"
  XCODE_ATTRIBUTE_CODE_SIGN_IDENTITY "Apple Development"
  VS_GLOBAL_KEYWORD "ManagedCProj"
  VS_DOTNET_REFERENCES "System;System.Core"
  VS_WINRT_EXTENSIONS TRUE
  VS_WINRT_REFERENCES "Windows"
  MAP_IMPORTED_CONFIG_DEBUG "Release"
  BUNDLE_EXTENSION "plugin"
  LINK_SEARCH_END_STATIC TRUE
  LINK_SEARCH_START_STATIC FALSE
  LINK_OPTIONS "-Wl,--as-needed"
  LINK_DEPENDS "${CMAKE_SOURCE_DIR}/version.lds"
  SOURCES "lib.cpp"
  COMPILE_DEFINITIONS_DEBUG "DEBUG=1"
  LINK_FLAGS_RELEASE "/OPT:REF"
)