#include <iostream>
#include <filesystem>

void delete_file(const std::string &file_name)
{
  try
  {
    if (std::filesystem::remove(file_name))
    {
      std::cout << file_name << " was deleted successfully.\n";
    }
    else
    {
      std::cout << file_name << " does not exist.\n";
    }
  }
  catch (const std::filesystem::filesystem_error &e)
  {
    std::cerr << "Filesystem error: " << e.what() << '\n';
  }
}

int main()
{
  const auto file_a = "test_a.txt";
  const auto file_b = "test_b.txt";

  delete_file(file_a);
  delete_file(file_b);

  return 0;
}