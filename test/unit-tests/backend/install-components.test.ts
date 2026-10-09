import { expect } from 'chai';
import { parseInstallComponents } from '@cmt/installComponents';

/**
 * Tests for parseInstallComponents() from src/installComponents.ts.
 *
 * This function extracts install component names from generated
 * `cmake_install.cmake` scripts, which is how `cmake.installComponent`
 * discovers the components available to install (issue #4281). The File API
 * does not expose component names, so parsing the install scripts is the only
 * reliable source.
 */

suite('Install component discovery', () => {
    test('extracts a single component', () => {
        const script = `
if(CMAKE_INSTALL_COMPONENT STREQUAL "libs" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL ...)
endif()
`;
        expect(parseInstallComponents([script])).to.deep.equal(['libs']);
    });

    test('extracts and de-duplicates multiple components from one script', () => {
        const script = `
if(CMAKE_INSTALL_COMPONENT STREQUAL "apps")
endif()
if(CMAKE_INSTALL_COMPONENT STREQUAL "libs")
endif()
if(CMAKE_INSTALL_COMPONENT STREQUAL "apps")
endif()
`;
        expect(parseInstallComponents([script])).to.deep.equal(['apps', 'libs']);
    });

    test('merges, de-duplicates and sorts across multiple scripts', () => {
        const scriptA = 'if(CMAKE_INSTALL_COMPONENT STREQUAL "docs")\nendif()';
        const scriptB = 'if(CMAKE_INSTALL_COMPONENT STREQUAL "apps")\nendif()';
        const scriptC = 'if(CMAKE_INSTALL_COMPONENT STREQUAL "docs")\nendif()';
        expect(parseInstallComponents([scriptA, scriptB, scriptC])).to.deep.equal(['apps', 'docs']);
    });

    test('returns an empty array when there are no components', () => {
        const script = 'file(INSTALL "foo.txt" DESTINATION "bar")';
        expect(parseInstallComponents([script])).to.deep.equal([]);
    });

    test('returns an empty array for empty input', () => {
        expect(parseInstallComponents([])).to.deep.equal([]);
    });
});
