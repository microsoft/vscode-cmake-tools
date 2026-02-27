import { expect } from 'chai';
import { parseInstallComponentsFromContent, containsPermissionError } from '@cmt/installUtils';

suite('parseInstallComponentsFromContent', () => {
    test('parses single component', () => {
        const content = `
if(CMAKE_INSTALL_COMPONENT STREQUAL "Runtime")
  file(INSTALL DESTINATION "\${CMAKE_INSTALL_PREFIX}/bin" TYPE EXECUTABLE FILES "/path/to/app")
endif()
`;
        const components = parseInstallComponentsFromContent(content);
        expect(components).to.deep.equal(['Runtime']);
    });

    test('parses multiple components', () => {
        const content = `
if(CMAKE_INSTALL_COMPONENT STREQUAL "Runtime")
  file(INSTALL DESTINATION "\${CMAKE_INSTALL_PREFIX}/bin" TYPE EXECUTABLE FILES "/path/to/app")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Development")
  file(INSTALL DESTINATION "\${CMAKE_INSTALL_PREFIX}/include" TYPE FILE FILES "/path/to/header.h")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Documentation")
  file(INSTALL DESTINATION "\${CMAKE_INSTALL_PREFIX}/share/doc" TYPE FILE FILES "/path/to/readme.md")
endif()
`;
        const components = parseInstallComponentsFromContent(content);
        expect(components).to.deep.equal(['Development', 'Documentation', 'Runtime']);
    });

    test('deduplicates repeated components', () => {
        const content = `
if(CMAKE_INSTALL_COMPONENT STREQUAL "Runtime")
  file(INSTALL DESTINATION "\${CMAKE_INSTALL_PREFIX}/bin" TYPE EXECUTABLE FILES "/path/to/app1")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Runtime")
  file(INSTALL DESTINATION "\${CMAKE_INSTALL_PREFIX}/bin" TYPE EXECUTABLE FILES "/path/to/app2")
endif()
`;
        const components = parseInstallComponentsFromContent(content);
        expect(components).to.deep.equal(['Runtime']);
    });

    test('returns empty array when no components found', () => {
        const content = `
# No install components in this file
cmake_minimum_required(VERSION 3.15)
`;
        const components = parseInstallComponentsFromContent(content);
        expect(components).to.deep.equal([]);
    });

    test('returns empty array for empty content', () => {
        const components = parseInstallComponentsFromContent('');
        expect(components).to.deep.equal([]);
    });

    test('returns sorted components', () => {
        const content = `
if(CMAKE_INSTALL_COMPONENT STREQUAL "Zebra")
  file(INSTALL DESTINATION "\${CMAKE_INSTALL_PREFIX}/bin" TYPE FILE FILES "/path/to/z")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Alpha")
  file(INSTALL DESTINATION "\${CMAKE_INSTALL_PREFIX}/bin" TYPE FILE FILES "/path/to/a")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Middle")
  file(INSTALL DESTINATION "\${CMAKE_INSTALL_PREFIX}/bin" TYPE FILE FILES "/path/to/m")
endif()
`;
        const components = parseInstallComponentsFromContent(content);
        expect(components).to.deep.equal(['Alpha', 'Middle', 'Zebra']);
    });

    test('handles typical cmake_install.cmake content', () => {
        const content = `# Install script for directory: /home/user/project

# Set the install prefix
if(NOT DEFINED CMAKE_INSTALL_PREFIX)
  set(CMAKE_INSTALL_PREFIX "/usr/local")
endif()
string(REGEX REPLACE "/\$" "" CMAKE_INSTALL_PREFIX "\${CMAKE_INSTALL_PREFIX}")

# Set the install configuration name.
if(NOT DEFINED CMAKE_INSTALL_CONFIG_NAME)
  if(BUILD_TYPE)
    string(REGEX REPLACE "^[^A-Za-z0-9_]+" "" CMAKE_INSTALL_CONFIG_NAME "\${BUILD_TYPE}")
  else()
    set(CMAKE_INSTALL_CONFIG_NAME "")
  endif()
  message(STATUS "Install configuration: \\"\${CMAKE_INSTALL_CONFIG_NAME}\\"")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Runtime" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "\${CMAKE_INSTALL_PREFIX}/bin" TYPE EXECUTABLE FILES "/path/to/app")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Development" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "\${CMAKE_INSTALL_PREFIX}/lib" TYPE STATIC_LIBRARY FILES "/path/to/lib.a")
endif()

if(CMAKE_INSTALL_COMPONENT STREQUAL "Headers" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "\${CMAKE_INSTALL_PREFIX}/include" TYPE FILE FILES "/path/to/header.h")
endif()
`;
        const components = parseInstallComponentsFromContent(content);
        expect(components).to.deep.equal(['Development', 'Headers', 'Runtime']);
    });

    test('handles components with special characters in names', () => {
        const content = `
if(CMAKE_INSTALL_COMPONENT STREQUAL "my-component_v2")
  file(INSTALL DESTINATION "\${CMAKE_INSTALL_PREFIX}/bin" TYPE FILE FILES "/path/to/file")
endif()
`;
        const components = parseInstallComponentsFromContent(content);
        expect(components).to.deep.equal(['my-component_v2']);
    });
});

suite('containsPermissionError', () => {
    test('detects "permission" keyword', () => {
        expect(containsPermissionError('file cannot copy: Permission denied')).to.be.true;
    });

    test('detects "cannot create directory" from CMake', () => {
        expect(containsPermissionError(
            'file cannot create directory: C:/Program Files/MyProject/include. Maybe need administrative privileges.'
        )).to.be.true;
    });

    test('detects "Access is denied" (Windows)', () => {
        expect(containsPermissionError('Error: Access is denied.')).to.be.true;
    });

    test('is case-insensitive', () => {
        expect(containsPermissionError('PERMISSION DENIED')).to.be.true;
        expect(containsPermissionError('Cannot Create Directory: /opt/app')).to.be.true;
    });

    test('returns false for unrelated errors', () => {
        expect(containsPermissionError('CMake Error: install(TARGETS) given no ARCHIVE DESTINATION')).to.be.false;
    });

    test('returns false for empty string', () => {
        expect(containsPermissionError('')).to.be.false;
    });
});
