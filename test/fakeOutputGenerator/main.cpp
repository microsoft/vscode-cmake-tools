#include <iostream>
#include <fstream>
#include <string>

std::string generateConfigFilename(std::string inputFileName) {
#ifdef _WIN32
    const std::string nameNoExt = (inputFileName.rfind(".exe") == inputFileName.size() - 4) ? inputFileName.substr(0, inputFileName.length() - 4) : inputFileName;
#else
    const std::string nameNoExt = inputFileName;
#endif
    return nameNoExt + ".cfg";
}

int main(int argc, char** argv) {

   std::string filePath = argv[0];
   std::string configFilePath = generateConfigFilename(filePath);

   std::ifstream inputData(configFilePath.c_str());

   if(inputData.good()) {
        for( std::string line; std::getline(inputData, line ); )
        {
            std::cerr << line << std::endl;
        }
   } else {
        std::cerr << "ERROR: config file is missing '" << configFilePath << "'" << std::endl;
        return -99;
    }
}
