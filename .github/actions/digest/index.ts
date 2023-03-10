/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OctoKit } from '../api/octokit';
import { Action } from '../common/action';

class DigestAction extends Action {
	id = 'Digest';

	async onTriggered(github: OctoKit) {
		console.log("Hello World!");
	}
}

new DigestAction().run(); // eslint-disable-line
