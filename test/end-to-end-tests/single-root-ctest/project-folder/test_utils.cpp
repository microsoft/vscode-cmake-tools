#include "test_utils.h"

#include <filesystem>
#include <fstream>
#include <iostream>

/********************************************************************************/
/**
 * @brief Generic test function that writes a file with the test result.
 * If the test is successful, the file will contain the test name and "OK".
 * Otherwise, the file will contain the test name and "KO".
 * 
 * @param test_filepath : the path to the file to write
 * @param success : the test result
 * @return int : 0 if the test is successful, 1 otherwise
 */
/********************************************************************************/
int generic_test(const std::string& test_filepath, const bool success) {
  std::filesystem::path test_path(test_filepath);
  const auto& test_name{test_path.stem()};

  std::ofstream outfile(test_filepath);
  if (outfile.is_open()) {
    outfile << test_name << " : \"" << (success ? "OK" : "KO") << "\"";
    outfile.close();
    std::cout << "File written successfully." << std::endl;
  } else {
    std::cerr << "Error opening file." << std::endl;
  }
  return success ? 0 : 1;
}