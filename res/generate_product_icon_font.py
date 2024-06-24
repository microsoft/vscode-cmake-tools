# FontForge script to generate a product icon font.
# SVG icons are imported recursively; filenames must start with a 4-digit hexadecimal glyph codepoint followed by an underscore
# Invoke by calling `fontforge -script <path_to_this_file>.py`

import fontforge
import os
import re

font = fontforge.font()

for dir, _, files in os.walk(os.path.dirname(__file__)):
    for file in filter(lambda x: re.match('^[0-9a-f]{4}_.*svg$', x, re.IGNORECASE), files):
        code = file[:4]; fp = os.path.join(dir, file)
        font.createChar(int(code, 16)).importOutlines(fp)
        print(f'Added U+{code} -> {fp}')

font.generate('product-icons.woff')
