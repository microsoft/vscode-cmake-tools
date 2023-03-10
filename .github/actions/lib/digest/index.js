"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const action_1 = require("../common/action");
class DigestAction extends action_1.Action {
    constructor() {
        super(...arguments);
        this.id = 'Digest';
    }
    async onTriggered(github) {
        console.log("Hello World!");
    }
}
new DigestAction().run(); // eslint-disable-line
//# sourceMappingURL=index.js.map