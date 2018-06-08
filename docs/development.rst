How to Contribute
=================

Developer Reference
-------------------

Documentation for the code itself is kept within the code, and is extracted via
TypeDoc. See the developer reference documentation `here <dev/index.html>`_.

Building extension
------------------
As with most VS Code extensions you need you need `Node.JS <https://nodejs.org/en/>`_ installed.

The process if fairly straightforward:

1. Install dependencies

.. code:: bash

    $ npm install

2. Compile the code:

.. code:: bash

    $ npm run compile

Of course build command (as few others) is available as Visual Studio Code task.

Coding guidelines
-----------------

Formatting
::::::::::
Code is formatted using ``clang-format``. It is recommended to install
`Clang-Format extension <https://marketplace.visualstudio.com/items?itemName=xaver.clang-format>`_.

Linting
:::::::
We use tslint for linting our sources.
You can run tslint across the sources by calling ``npm run lint`` from a terminal or command prompt.
You can also run ``npm: lint`` as a Code task by pressing ``CMD+P`` (``CTRL+P`` on Windows) and entering ``task lint``.
Warnings from tslint show up in the Errors and Warnings quick box and you can navigate to them from inside Code.
To lint the source as you make changes you can install the `tslint extension <https://marketplace.visualstudio.com/items/eg2.tslint>`_.

Style
:::::

* Use inline field initializers whenever possible.
* Declare properties in constructor parameters lists, when possible.
* Use ``lowerCamelCase`` for public members, methods, and function/method parameters.
* Use ``snake_case`` for variables.
* Use ``kebab-case`` for files and directories. (hyphen-separated-names)
* Prefix private members/methods with an underscore and write them ``_withCamelCase``
