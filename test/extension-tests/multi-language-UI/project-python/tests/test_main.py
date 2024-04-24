import unittest
from unittest.mock import patch
from main import main


class TestMain(unittest.TestCase):
    @patch('main.print')
    def test_main(self, mock_print):
        main()
        mock_print.assert_called_with('Hello world!')
