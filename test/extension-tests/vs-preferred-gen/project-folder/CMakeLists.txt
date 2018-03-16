cmake_minimum_required(VERSION 3.0.0)
project(TestBuildProcess VERSION 0.1.0)

add_executable(TestBuildProcess main.cpp)

add_custom_command(
    TARGET TestBuildProcess
    POST_BUILD
    COMMAND $<TARGET_FILE:TestBuildProcess> > output.txt
    WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
    COMMENT "Running in ${CMAKE_CURRENT_BINARY_DIR}"
)
