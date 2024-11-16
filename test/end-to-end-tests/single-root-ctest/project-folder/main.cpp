#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

/********************************************************************************/
/**
 * @brief Dump the content of a file to a string.
 *
 * @param filename : The name of the file to dump.
 * @return std::string : The content of the file or empty in case of error.
 */
/********************************************************************************/
std::string dump_file(const std::string &filename)
{
    std::filesystem::path filepath(filename);
    if (!std::filesystem::exists(filepath))
    {
        std::cerr << "File does not exist: " << filename << '\n';
        return {};
    }
    std::ifstream ifs(filepath, std::ifstream::in);
    if (!ifs)
    {
        std::cerr << "Failed to open file: " << filename << '\n';
        return {};
    }
    std::ostringstream oss;
    for (std::string line; std::getline(ifs, line);)
    {
        oss << line;
        if (ifs.good())
        {
            oss << '\n';
        }
    }
    if (ifs.bad())
    {
        std::cerr << "Failed to read file: " << filename << '\n';
        return {};
    }
    return oss.str();
}

/********************************************************************************/
/**
 * @brief Generate an output file containing the content of the input files
 * separated by commas and enclosed in curly braces.
 *
 * The output file is named output_test.txt and is created in the current
 * directory.
 * 
 * The output file is in json format provided that the input files are in text
 * format.
 * 
 * @param file_names : The list of input files to dump.
 * @return int : 0 if the output file was successfully generated, 1 otherwise.
 */
/********************************************************************************/
int generate_output_file(const std::vector<std::string> &file_names)
{
    std::ofstream ofs_test("output_test.txt");
    if (!ofs_test)
    {
        std::cerr << "Failed to open output_test.txt\n";
        return 1;
    }

    ofs_test << "{\n";

    for (auto iter{std::cbegin(file_names)}; iter != std::cend(file_names); ++iter)
    {
        const auto &ccontent = dump_file(*iter);
        if (!ccontent.empty())
        {
            ofs_test << ccontent;
        }

        if (std::next(iter) != std::cend(file_names))
        {
            const bool has_empty_successor = dump_file(*(std::next(iter))).empty();
            if (!has_empty_successor)
            {
                ofs_test << ",";
            }
        }
        ofs_test << "\n";
    }

    ofs_test << "}\n";
    return 0;
}

/*----------------------------------------------------------------------------*/
/**
 * @brief Main function.
 *
 * @return int : 0 if the output file was successfully generated, 1 otherwise.
 */
/*----------------------------------------------------------------------------*/
int main(int, char **)
{
    return generate_output_file({"/tmp/test_a.txt", "/tmp/test_b.txt"});
}