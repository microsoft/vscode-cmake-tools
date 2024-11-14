#include <fstream>
#include <iostream>

int main() {
  std::ofstream outfile("/tmp/test_a.txt");
  if (outfile.is_open()) {
    outfile << "\"test_a\": \"OK\"";
    outfile.close();
    std::cout << "File written successfully." << std::endl;
  } else {
    std::cerr << "Error opening file." << std::endl;
  }
  return 0;
}