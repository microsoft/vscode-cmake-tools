#include <fstream>
#include <filesystem>
#include <iostream>
#include <sstream>
#include <string>

/********************************************************************************/
/**
 * @brief Dump the content of a file to a string.
 * 
 * @param filename : The name of the file to dump.
 * @return std::string : The content of the file.
 */
/********************************************************************************/
std::string dump_file(const std::string& filename) {
    std::filesystem::path filepath(filename);
    if (!std::filesystem::exists(filepath)) {
        std::cerr << "File does not exist: " << filename << '\n';
        return {};
    }
    std::ifstream ifs (filepath, std::ifstream::in);
    if (!ifs) {
        std::cerr << "Failed to open file: " << filename << '\n';
        return {};
    }
    std::ostringstream oss;
    for (std::string line; std::getline(ifs, line);) {
        oss << line;
        if (ifs.good()) {
            oss <<'\n';
        }
    }
    if (ifs.bad()) {
        std::cerr << "Failed to read file: " << filename << '\n';
        return {};
    }
    return oss.str();
}

int main(int, char**) {
    std::ofstream ofs_test("output_test.txt");
    if (!ofs_test) {
        std::cerr << "Failed to open output_test.txt\n";
        return 1;
    }

    const auto& content_a = dump_file("/tmp/test_a.txt");
    const auto& content_b = dump_file("/tmp/test_b.txt");

    ofs_test << "{\n";
    if (!content_a.empty())
    {
        ofs_test << content_a;
        if (!content_b.empty())
        {
            ofs_test << ",";
        }
        ofs_test << "\n";
    }
    ofs_test << content_b;
    ofs_test << "}\n";
    return 0;
}