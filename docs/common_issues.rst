.. _common-issues:


Common Issues and Resolutions
#############################

There are a few frequently appearing issues in the CMake Tools issue tracker.
Make sure you've checked that your issue isn't already solved here before
submitting a question or bug report.


.. _missing-config:

I see: 'CMake Tools' is unable to provide IntelliSense configuration ...
************************************************************************

If you are seeing this informational pop-up appear, or are seeing that
``#include`` directives are not resolving in the editor (you see a green
underline on the ``#include`` directive), this means that the relevant source
file is not attached to a CMake Target.

.. note::
    The target of a failing ``#include`` directive **need not** be a source
    file of your target. This is only concerning the file *containing* the
    failing ``#include`` directive!

If the file which receives this message is outside of your project, it is safe
to ignore it.

If you are receiving this message for files *within* your project, it means you
probably need to add the source file to a target.

This is most common with header files in a project. **Header files should be
included in the source list of a target**. Even though CMake will not try to
compile or process these headers in any special way, CMake Tools uses this
information in a variety of places to provide a better user experience.


.. _failing-include:

I see green underlines/squiggles beneath my ``#include`` directives in my source files
**************************************************************************************

.. note::
    Please refer to :ref:`missing-config`


.. _debug-button-no-launch:

The "Debug" button and "Debug target" features are ignoring my ``launch.json``
******************************************************************************

If you wish to specify additional debugging options, and/or use a different
debugging engine, refer to :ref:`debugging.launch-json`.

.. note::
    The target debugging feature is restricted to launching target executables
    with a default configuration in cpptools' debugging engine.
