#include <cstdlib>
#include <fstream>
#include <iostream>
#include <string>

#ifndef _CMAKE_VERSION
    #define _CMAKE_VERSION "0.0"
#endif

#ifndef _GENERATOR
    #define _GENERATOR ""
#endif

std::string getCompilerName() {
    return C_COMPILER_ID;
}

std::string get_env_var(const std::string& key) {
    const char* env = std::getenv(key.c_str());
    return env != NULL ? env : "";
}

int main(int, char**) {
    std::cout << "{\n";
    std::cout << "  \"compiler\": \"" << getCompilerName() << "\",\n";
    std::cout << "  \"cookie\": \"" CMT_COOKIE "\",\n";
    std::cout << "  \"cmake-version\": \"" << _CMAKE_VERSION << "\",\n";
    std::cout << "  \"cmake-generator\": \"" << _GENERATOR << "\",\n";
    std::cout << "  \"configure-env\": \"" << get_env_var("_CONFIGURE_ENV") << "\",\n";
    std::cout << "  \"build-env\": \"" << get_env_var("_BUILD_ENV") << "\",\n";
    std::cout << "  \"env\": \"" << get_env_var("_ENV") << "\"\n";
    std::cout << "}\n";

    std::ofstream ofs ("test.txt", std::ofstream::out);
    ofs << "{\n";
    ofs << "  \"cookie\": \"" CMT_COOKIE "\",\n";
    ofs << "}\n";
}