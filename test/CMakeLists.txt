add_test(
    NAME cmt.lint.tslint
    COMMAND "${NODE_EXECUTABLE}" "${PROJECT_SOURCE_DIR}/node_modules/tslint/bin/tslint" -p "${PROJECT_SOURCE_DIR}"
    WORKING_DIRECTORY "${PROJECT_SOURCE_DIR}"
    )

set(code_ext_lock vscode.runlock)

add_test(
    NAME cmt.test.unit.all
    COMMAND "${NODE_EXECUTABLE}" "${PROJECT_SOURCE_DIR}/node_modules/vscode/bin/test"
    WORKING_DIRECTORY "${PROJECT_SOURCE_DIR}"
    )
set(unit_env
    CMT_TESTING=1
    CODE_TESTS_PATH=${PROJECT_SOURCE_DIR}/out/test/unit-tests
    CODE_TESTS_WORKSPACE=${PROJECT_SOURCE_DIR}/test/unit-tests/test-project-without-cmakelists
    )
set_tests_properties(cmt.test.unit.all PROPERTIES
    ENVIRONMENT "${unit_env}"
    RESOURCE_LOCK "${code_ext_lock}"
    )

foreach(test vs-preferred-gen successful-build without-cmakelist-file)
    set(name cmt.test.smoke.${test})
    add_test("${name}"
        ${NODE_EXECUTABLE} ${PROJECT_SOURCE_DIR}/node_modules/vscode/bin/test
        )
    set(env
        CMT_TESTING=1
        CODE_TESTS_PATH=${PROJECT_SOURCE_DIR}/out/test/extension-tests/${test}
        CODE_TESTS_WORKSPACE=${PROJECT_SOURCE_DIR}/test/extension-tests/${test}/project-folder
        )
    set_tests_properties("${name}" PROPERTIES
        ENVIRONMENT "${env}"
        WORKING_DIRECTORY "${PROJECT_SOURCE_DIR}"
        RESOURCE_LOCK "${code_ext_lock}"
        )
endforeach()
