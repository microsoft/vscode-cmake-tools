#include <iostream>
#include <string>
#include <cstdlib>

#ifndef _CMAKE_VERSION
    #define _CMAKE_VERSION "0.0"
#endif

#ifndef _GENERATOR
    #define _GENERATOR ""
#endif

std::string getCompilerName() {
    #if defined(__clang__)
	    return "Clang/LLVM";
    #elif defined(__GNUC__) || defined(__GNUG__)
        return "GNU GCC/G++";
    #elif defined(_MSC_VER)
        return "Microsoft Visual Studio";
    #endif
}

std::string get_env_var(const std::string& key) {
    const char* env = std::getenv(key.c_str());
    return env != NULL ? env : "";
}

int main(int, char**) {
    std::cout << "{\n";
    std::cout << "  \"compiler\": \"" << getCompilerName() << "\",\n";
    std::cout << "  \"cookie\": \"passed-cookie\",\n";
    std::cout << "  \"cmake-version\": \"" << _CMAKE_VERSION << "\",\n";
    std::cout << "  \"cmake-generator\": \"" << _GENERATOR << "\",\n";
    std::cout << "  \"configure-env\": \"" << get_env_var("_CONFIGURE_ENV") << "\",\n";
    std::cout << "  \"build-env\": \"" << get_env_var("_BUILD_ENV") << "\",\n";
    std::cout << "  \"env\": \"" << get_env_var("_ENV") << "\"\n";
    std::cout << "}\n";
}