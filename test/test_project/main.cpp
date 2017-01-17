#include <iostream>

// IMPORTANT: This line is in a specific location which is tested for. If you
// move this #error line, make sure you update the test for this diagnostic
// message
#ifdef CMT_DO_BUILD_ERROR
#error "special-error-cookie asdfqwerty"
#endif

#include <vector>
#include <string>
#include <algorithm>
#include <cassert>
#include <fstream>

typedef std::vector<std::string>::const_iterator iter;

extern int get_num();

int main(int argc, char** argv) {
    std::cout << "Hello, CMake Tools!\n";
    const std::vector<std::string> args(argv, argv + argc);
    const iter write_file = std::find(args.begin(), args.end(), std::string("--write-file"));
    if(write_file != args.end()) {
        const iter filename = write_file + 1;
        assert(filename != args.end());
        std::ofstream outfile(filename->data());
        const iter content_flag = std::find(args.begin(), args.end(), std::string("--content"));
        const iter env_flag = std::find(args.begin(), args.end(), std::string("--env"));
        if (content_flag != args.end()) {
            const iter content = content_flag + 1;
            assert(content != args.end());
            outfile << *content;
        } else if (env_flag != args.end()) {
            const iter env_var = env_flag + 1;
            assert(env_var != args.end());
            const char* const env = std::getenv(env_var->data());
            outfile << (env ? env : "");
        } else {
            outfile << "This is the hardcoded string";
        }
    }
    get_num();
    return 0;
}