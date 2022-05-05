#include <iostream>
#include <fstream>
#include <string>
#ifdef _WIN32
#include <Windows.h>
#endif

std::string generateConfigFilename(std::string inputFileName)
{
#ifdef _WIN32
    const std::string nameNoExt = (inputFileName.rfind(".exe") == inputFileName.size() - 4) ? inputFileName.substr(0, inputFileName.length() - 4) : inputFileName;
#else
    const std::string nameNoExt = inputFileName;
#endif
    return nameNoExt + ".cfg";
}

int main(int argc, char** argv)
{
#ifdef _WIN32
    char buffer[MAX_PATH];
    DWORD length = GetModuleFileName(NULL, buffer, MAX_PATH);
    std::string filePath(buffer);
#else
    std::string filePath = argv[0];
#endif
    std::string configFilePath = generateConfigFilename(filePath);
    std::ifstream inputData(configFilePath.c_str());

    if (inputData.good())
    {
        for (std::string line; std::getline(inputData, line ); )
        {
            std::cerr << line << std::endl;
        }
    }
    else
    {
        std::cerr << "Argv[0]" << argv[0] << std::endl;
        std::cerr << "ERROR: config file is missing '" << configFilePath << "'" << std::endl;
        return -99;
    }
}
