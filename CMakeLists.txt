cmake_minimum_required(VERSION 3.7)

project(CMakeTools VERSION 0.11.0 LANGUAGES NONE)

find_program(NPM_EXECUTABLE npm)
find_program(VSCE_EXECUTABLE vsce)
find_program(SPHINX_EXECUTABLE sphinx-build)

get_filename_component(package_json package.json ABSOLUTE)
get_filename_component(package_lock package-lock.json ABSOLUTE)
get_filename_component(npm_stamp "${CMAKE_CURRENT_BINARY_DIR}/npm.stamp" ABSOLUTE)
add_custom_command(OUTPUT ${npm_stamp}
    DEPENDS ${package_json}
    COMMAND ${NPM_EXECUTABLE} install
    COMMAND ${CMAKE_COMMAND} -E touch ${npm_stamp}
    COMMENT "Installing dependencies..."
    WORKING_DIRECTORY "${PROJECT_SOURCE_DIR}"
    USES_TERMINAL
    )
add_custom_target(npm-install DEPENDS ${package_lock} ${npm_stamp})

add_custom_target(compile ALL
    DEPENDS npm-install
    COMMAND ${NPM_EXECUTABLE} run compile-once
    COMMENT "Compiling TypeScript code..."
    WORKING_DIRECTORY "${PROJECT_SOURCE_DIR}"
    # USES_TERMINAL
    )

add_custom_target(vsce-package
    DEPENDS npm-install
    COMMAND ${VSCE_EXECUTABLE} package
    COMMENT "Generating VSCode package"
    WORKING_DIRECTORY "${PROJECT_SOURCE_DIR}"
    )

if(SPHINX_EXECUTABLE)
    message(STATUS "Build documentation with the `docs` target")
    add_custom_target(docs
        COMMAND ${SPHINX_EXECUTABLE}
            -W # Warning as error
            -q # Quiet. Only warnings and errors
            -C
            -D source_suffix=.rst
            -D master_doc=index
            -D project=${PROJECT_NAME}
            -D version=${PROJECT_VERSION}
            -D release=${PROJECT_VERSION}
            -D pygments_style=sphinx
            -D html_theme=nature
            # -D "html_static_path=_static,"
            -D html_logo=../res/icon_190.svg
            -b html
            -j 10
            "${CMAKE_CURRENT_SOURCE_DIR}/docs"
            "${CMAKE_CURRENT_BINARY_DIR}/docs"
        COMMAND "${NPM_EXECUTABLE}" --silent docs
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
        COMMENT "Generating documentation"
        )
endif()
