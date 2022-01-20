"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../common/utils");
const locker_1 = require("./locker");
const action_1 = require("../common/action");
class LockerAction extends action_1.Action {
    constructor() {
        super(...arguments);
        this.id = 'Locker';
    }
    async onTriggered(github) {
        await new locker_1.Locker(github, +utils_1.getRequiredInput('daysSinceClose'), +utils_1.getRequiredInput('daysSinceUpdate'), utils_1.getInput('labels') || undefined, utils_1.getInput('milestoneName') || undefined, utils_1.getInput('milestoneId') || undefined, utils_1.getInput('ignoreLabels') || undefined, utils_1.getInput('ignoreMilestoneNames') || undefined, utils_1.getInput('ignoreMilestoneIds') || undefined, +(utils_1.getInput('minimumVotes') || 0), +(utils_1.getInput('maximumVotes') || 9999999)).run();
    }
}
new LockerAction().run(); // eslint-disable-line
//# sourceMappingURL=index.js.map