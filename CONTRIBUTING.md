# How to Contribute to CMake Tools

This article is for developers who want to contribute to the CMake Tools open source project.

## Build the CMake Tools extension

As with most VS Code extensions, you'll need [Node.JS](https://nodejs.org/en/) installed. We use yarn to compile the code (run `npm install -g yarn` to install it).

The process is:

1. Open the repo in VS Code

2. Press <kbd>F5</kbd> to build and run the extension

## Coding guidelines

### Formatting

Code is formatted using the default TypeScript formatter in VS Code and uses 4 space indentation.

### Linting

We use eslint for linting our sources.
You can run `eslint` across the sources from a terminal or command prompt by running `yarn run lint`.
Warnings from `eslint` show up in the **Errors and Warnings** pane and you can navigate to them from inside VS Code.
To lint the source as you make changes, install the [eslint extension](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint).

### Style [Updated!]

Follow the [Typescript Coding guidelines](https://github.com/Microsoft/TypeScript/wiki/Coding-guidelines).

> `snake_case` was used historically for variables in this repo, but that style is phased out. All new variables should be `lowerCamelCase`. The existing variables will be migrated to the new naming soon (or you can help out with a pull request!)

### Changelog

Please update the CHANGELOG.md file as part of your pull request. Follow the style within that file and give yourself credit for the changes you make.
