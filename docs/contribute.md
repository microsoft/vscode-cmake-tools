# How to Contribute to CMake Tools

This article is for developers who want to contribute to the CMake Tools open source project.

## Build the CMake Tools extension

As with most VS Code extensions, you'll need [Node.JS](https://nodejs.org/en/) installed. We use [yarn](https://yarnpkg.com/getting-started/install) to compile the code.

The process is:

1. Open the repo in VS Code

2. Press <kbd>F5</kbd> to build and run the extension

## Coding guidelines

### Formatting

Code is formatted using `clang-format`. We recommend you install the
[Clang-Format extension](https://marketplace.visualstudio.com/items?itemName=xaver.clang-format).

### Linting

We use tslint for linting our sources.
You can run `tslint` across the sources from a terminal or command prompt by running `npm run lint`.
You can also run `npm: lint` from the VS Code command pallette ry running the `task lint` command.
Warnings from `tslint` show up in the **Errors and Warnings** pane and you can navigate to them from inside VS Code.
To lint the source as you make changes, install the [tslint extension](https://marketplace.visualstudio.com/items/eg2.tslint).

### Style

* Use inline field initializers whenever possible.
* Declare properties in constructor parameters lists, when possible.
* Use `lowerCamelCase` for public members, methods, and function/method parameters.
* Use `snake_case` for variables.
* Use `kebab-case` (hyphen-separated-names) for files and directories. 
* Prefix private members/methods with an underscore and write them `_withCamelCase`.
