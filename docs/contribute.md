# How to Contribute to CMake Tools

This article is for developers who want to contribute to the CMake Tools open source project.

## Developer Reference

Documentation for the code is kept within the code, and is extracted via `TypeDoc`.

## Build the CMake Tools extension

As with most VS Code extensions, you'll need `Node.JS <https://nodejs.org/en/>` installed.

The process is:

1. Install dependencies

```bash
$ npm install
```

1. Compile the code:

```bash
$ npm install
```

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
