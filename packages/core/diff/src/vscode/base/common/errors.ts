/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Lo: the diff throws where VS Code would report an unexpected error later, so a caller can fall
// back to a coarser diff of that one file.
export function onUnexpectedError(e: unknown): never {
  throw e;
}

export class BugIndicatingError extends Error {
  constructor(message?: string) {
    super(message || 'An unexpected bug occurred.');
    Object.setPrototypeOf(this, BugIndicatingError.prototype);

    // Because we know for sure only buggy code throws this,
    // we definitely want to break here and fix the bug.
    // debugger;
  }
}
