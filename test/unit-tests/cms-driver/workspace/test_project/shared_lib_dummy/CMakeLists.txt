add_library (SharedLibDummy SHARED "src/info.c")

target_include_directories (SharedLibDummy PUBLIC "inc")
target_compile_definitions (SharedLibDummy PRIVATE TEST_CMAKE_DEFINE)