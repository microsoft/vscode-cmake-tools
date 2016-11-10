#include <iostream>

// IMPORTANT: This line is in a specific location which is tested for. If you
// move this #error line, make sure you update the test for this diagnostic
// message
#ifdef CMT_DO_BUILD_ERROR
#error "special-error-cookie asdfqwerty"
#endif

int main() {
    std::cout << "Hello, CMake Tools!\n";
    return 0;
}