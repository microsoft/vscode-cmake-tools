#include <iostream>
#include <string>

#ifndef _CMAKE_VERSION
    #define _CMAKE_VERSION "0.0"
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

int main(int, char**) {
    std::cout << "{\n";
    std::cout << "  \"compiler\": \"" << getCompilerName() << "\",\n";
    std::cout << "  \"cmake-version\": \"" << _CMAKE_VERSION << "\"\n";
    std::cout << "}\n";
}
