#include <iostream>
#include <fstream>
#include <string>

std::string generateConfigFilename(std::string inputFileName) {
    static const int EXT_LENGTH = 4;
    static const char* CONFIG_EXTENSION = ".cfg";
    std::string configFilePath = inputFileName;
    if (configFilePath.length() > EXT_LENGTH) {
        int extPosition = configFilePath.length() - EXT_LENGTH;
        std::string fileEnd = configFilePath.substr(extPosition, EXT_LENGTH);

        if (fileEnd[0] == '.') {
            configFilePath = configFilePath.replace(extPosition, 4, CONFIG_EXTENSION);
        } else {
            configFilePath.append(CONFIG_EXTENSION);
        }
    }
    return configFilePath;
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
