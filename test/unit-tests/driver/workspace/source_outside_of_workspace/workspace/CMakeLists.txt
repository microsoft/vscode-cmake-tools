cmake_minimum_required(VERSION 3.0.0)
project(source_outside_of_workspace VERSION 0.1.0)

add_executable(root_target ../main.cpp)
add_subdirectory(subdir)
