# CMake Cache Editor

CMake Tools has an experimental GUI for editing your CMake Cache content. It is
based on the Qt GUI that comes with the default CMake installation.

![The CMake Cache Editor](../images/cache_editor.png)

String cache enties will appear as text edit fields, while boolean cache entries
appear as checkboxes. Changes are committed once "Configure" or "Build" is
pressed within the cache editor.

## List Editting

For strings which contain semicolons `;`, the cache editor will split them
into several text fields and stack them on top of eachother in the list
ordering. To add a new item to the list, simply use a semicolon in one of the
fields, and the cache editor will move it to it's own field after "Configure"
is pressed. To remove an entry from a list, simply clear the content from the
field that you wish to remove.

## Missing Features

The cache editor is still new, and the following features are yet-to-be added,
but should be supported in the future:

- Support for the `STRINGS` property of cache entries (which would make a cache
  entry a drop-down menu rather than a free text field).
- Support for file/path selection/validation.
- Adding arbitrary new cache entries.