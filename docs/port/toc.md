[Source](https://vector-of-bool.github.io/docs/vscode-cmake-tools/index.html "Permalink to CMake Tools for Visual Studio Code — CMake Tools 1.4.0
 documentation")

# CMake Tools for Visual Studio Code — CMake Tools 1.4.0
 documentation

### Navigation

* [index][1]
* [next][2] |
* [CMake Tools 1.4.0 documentation][3] »

# CMake Tools for Visual Studio Code[¶][4]

CMake Tools is an extension designed to make working with CMake-based projects as easy as possible. If you are new, check the [Getting Started][5] docs. Also check the [How Do I…][6] docs and the [Frequently Asked Questions][7].

Contents:

* [Getting Started][8]
    * [CMake Tools' _Quick Start_][9]
    * [Configuring Your Project][10]
    * [Building Your Project][11]
    * [Accessing Build Results][12]
* [CMake Kits][13]
    * [How Are Kits Found and Defined?][14]
    * [Kit Options][15]
* [CMake Variants][16]
    * [What does it look like?][17]
    * [The Variant Schema][18]
    * [How Variants Are Applied][19]
    * [A Big Example][20]
* [CMake Configuring][21]
    * [A Crash-Course on CMake's Configuration Process][22]
    * [How CMake Tools Configures][23]
    * [Configuring Outside of CMake Tools][24]
    * [A "Clean" Configure][25]
* [CMake Building][26]
    * [The Default Target][27]
    * [Building a Single Target][28]
    * [How CMake Tools Builds][29]
    * [Cleaning Up][30]
* [Target Debugging and Launching][31]
    * [Selecting a Launch Target][32]
    * [Quick Debugging][33]
    * [Debugging with CMake Tools and `launch.json`][34]
    * [Running Targets Without a Debugger][35]
* [Configuring CMake Tools][36]
    * [Available Settings][37]
    * [Variable Substitution][38]
* [Common Issues and Resolutions][39]
    * [I see: 'CMake Tools' is unable to provide IntelliSense configuration …][40]
    * [I see green underlines/squiggles beneath my `#include` directives in my source files][41]
    * [The "Debug" button and "Debug target" features are ignoring my `launch.json`][42]
* [Troubleshooting CMake Tools][43]
    * [Reset the Extension State][44]
    * [Increasing the Log Level][45]
    * [Checking the Log File][46]
    * [Check for a GitHub Issue][47]
    * [Ask Around the Support Chat][48]
    * [Open a GitHub Issue][49]
* [Frequently Asked Questions][50]
    * [How Can I Get Help?][51]
    * [What About CMake Language Support?][52]
    * [I'm New to CMake. Help?][53]
    * [How Does it Work with C and C++ IntelliSense?][54]
    * [How Do I ``?][55]
    * [Will CMake Tools Ever Support ``?][56]
* [How Do I…][57]
    * [Create a New Project?][58]
    * [Configure a Project?][59]
    * [Build a Project?][60]
    * [Debug a Project?][61]
    * [Pass Command Line Argument to the Debugger?][62]
    * [Set Up Include Paths for C++ IntelliSense?][63]
* [How to Contribute][64]
    * [Developer Reference][65]
    * [Building extension][66]
    * [Coding guidelines][67]
* [Changelog and History][68]
    * [1.1.3][69]
    * [1.1.2][70]
    * [1.1.1][71]
    * [1.1.0][72]
    * [1.0.1][73]
    * [1.0.0][74]
    * [0.11.1][75]
    * [0.11.0][76]
    * [0.10.x and Older][77]

# Indices and tables[¶][78]

* [Index][79]
* [Module Index][80]
* [Search Page][81]

[ ![Logo][82] ][3]

### [Table of Contents][3]

* [CMake Tools for Visual Studio Code][3]
* [Indices and tables][83]

#### Next topic

[Getting Started][84]

### This Page

* [Show Source][85]

### Quick search

### Navigation

* [index][1]
* [next][2] |
* [CMake Tools 1.4.0 documentation][3] »

© Copyright . Created using [Sphinx][86] 2.2.1. 

[1]: https://vector-of-bool.github.io/genindex.html "General Index"
[2]: https://vector-of-bool.github.io/getting_started.html "Getting Started"
[3]: https://vector-of-bool.github.io#
[4]: https://vector-of-bool.github.io#cmake-tools-for-visual-studio-code "Permalink to this headline"
[5]: https://vector-of-bool.github.io/getting_started.html#getting-started
[6]: https://vector-of-bool.github.io/how_do_i.html#how-do-i
[7]: https://vector-of-bool.github.io/faq.html#faq
[8]: https://vector-of-bool.github.io/getting_started.html
[9]: https://vector-of-bool.github.io/getting_started.html#cmake-tools-quick-start
[10]: https://vector-of-bool.github.io/getting_started.html#configuring-your-project
[11]: https://vector-of-bool.github.io/getting_started.html#building-your-project
[12]: https://vector-of-bool.github.io/getting_started.html#accessing-build-results
[13]: https://vector-of-bool.github.io/kits.html
[14]: https://vector-of-bool.github.io/kits.html#how-are-kits-found-and-defined
[15]: https://vector-of-bool.github.io/kits.html#kit-options
[16]: https://vector-of-bool.github.io/variants.html
[17]: https://vector-of-bool.github.io/variants.html#what-does-it-look-like
[18]: https://vector-of-bool.github.io/variants.html#the-variant-schema
[19]: https://vector-of-bool.github.io/variants.html#how-variants-are-applied
[20]: https://vector-of-bool.github.io/variants.html#a-big-example
[21]: https://vector-of-bool.github.io/configuring.html
[22]: https://vector-of-bool.github.io/configuring.html#a-crash-course-on-cmake-s-configuration-process
[23]: https://vector-of-bool.github.io/configuring.html#how-cmake-tools-configures
[24]: https://vector-of-bool.github.io/configuring.html#configuring-outside-of-cmake-tools
[25]: https://vector-of-bool.github.io/configuring.html#a-clean-configure
[26]: https://vector-of-bool.github.io/building.html
[27]: https://vector-of-bool.github.io/building.html#the-default-target
[28]: https://vector-of-bool.github.io/building.html#building-a-single-target
[29]: https://vector-of-bool.github.io/building.html#how-cmake-tools-builds
[30]: https://vector-of-bool.github.io/building.html#cleaning-up
[31]: https://vector-of-bool.github.io/debugging.html
[32]: https://vector-of-bool.github.io/debugging.html#selecting-a-launch-target
[33]: https://vector-of-bool.github.io/debugging.html#quick-debugging
[34]: https://vector-of-bool.github.io/debugging.html#debugging-with-cmake-tools-and-launch-json
[35]: https://vector-of-bool.github.io/debugging.html#running-targets-without-a-debugger
[36]: https://vector-of-bool.github.io/settings.html
[37]: https://vector-of-bool.github.io/settings.html#available-settings
[38]: https://vector-of-bool.github.io/settings.html#variable-substitution
[39]: https://vector-of-bool.github.io/common_issues.html
[40]: https://vector-of-bool.github.io/common_issues.html#i-see-cmake-tools-is-unable-to-provide-intellisense-configuration
[41]: https://vector-of-bool.github.io/common_issues.html#i-see-green-underlines-squiggles-beneath-my-include-directives-in-my-source-files
[42]: https://vector-of-bool.github.io/common_issues.html#the-debug-button-and-debug-target-features-are-ignoring-my-launch-json
[43]: https://vector-of-bool.github.io/troubleshooting.html
[44]: https://vector-of-bool.github.io/troubleshooting.html#reset-the-extension-state
[45]: https://vector-of-bool.github.io/troubleshooting.html#increasing-the-log-level
[46]: https://vector-of-bool.github.io/troubleshooting.html#checking-the-log-file
[47]: https://vector-of-bool.github.io/troubleshooting.html#check-for-a-github-issue
[48]: https://vector-of-bool.github.io/troubleshooting.html#ask-around-the-support-chat
[49]: https://vector-of-bool.github.io/troubleshooting.html#open-a-github-issue
[50]: https://vector-of-bool.github.io/faq.html
[51]: https://vector-of-bool.github.io/faq.html#how-can-i-get-help
[52]: https://vector-of-bool.github.io/faq.html#what-about-cmake-language-support
[53]: https://vector-of-bool.github.io/faq.html#i-m-new-to-cmake-help
[54]: https://vector-of-bool.github.io/faq.html#how-does-it-work-with-c-and-c-intellisense
[55]: https://vector-of-bool.github.io/faq.html#how-do-i-xyz
[56]: https://vector-of-bool.github.io/faq.html#will-cmake-tools-ever-support-xyz
[57]: https://vector-of-bool.github.io/how_do_i.html
[58]: https://vector-of-bool.github.io/how_do_i.html#create-a-new-project
[59]: https://vector-of-bool.github.io/how_do_i.html#configure-a-project
[60]: https://vector-of-bool.github.io/how_do_i.html#build-a-project
[61]: https://vector-of-bool.github.io/how_do_i.html#debug-a-project
[62]: https://vector-of-bool.github.io/how_do_i.html#pass-command-line-argument-to-the-debugger
[63]: https://vector-of-bool.github.io/how_do_i.html#set-up-include-paths-for-c-intellisense
[64]: https://vector-of-bool.github.io/development.html
[65]: https://vector-of-bool.github.io/development.html#developer-reference
[66]: https://vector-of-bool.github.io/development.html#building-extension
[67]: https://vector-of-bool.github.io/development.html#coding-guidelines
[68]: https://vector-of-bool.github.io/changelog.html
[69]: https://vector-of-bool.github.io/changelog.html#changes-1-1-3
[70]: https://vector-of-bool.github.io/changelog.html#changes-1-1-2
[71]: https://vector-of-bool.github.io/changelog.html#changes-1-1-1
[72]: https://vector-of-bool.github.io/changelog.html#changes-1-1-0
[73]: https://vector-of-bool.github.io/changelog.html#changes-1-0-1
[74]: https://vector-of-bool.github.io/changelog.html#changes-1-0-0
[75]: https://vector-of-bool.github.io/changelog.html#changes-0-11-0
[76]: https://vector-of-bool.github.io/changelog.html#id21
[77]: https://vector-of-bool.github.io/changelog.html#x-and-older
[78]: https://vector-of-bool.github.io#indices-and-tables "Permalink to this headline"
[79]: https://vector-of-bool.github.io/genindex.html
[80]: https://vector-of-bool.github.io/py-modindex.html
[81]: https://vector-of-bool.github.io/search.html
[82]: https://vector-of-bool.github.io/_static/logo.svg
[83]: https://vector-of-bool.github.io#indices-and-tables
[84]: https://vector-of-bool.github.io/getting_started.html "next chapter"
[85]: https://vector-of-bool.github.io/_sources/index.rst.txt
[86]: http://sphinx-doc.org/

  