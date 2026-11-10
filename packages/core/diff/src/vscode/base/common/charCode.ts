/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Lo: the character codes the diff uses, from VS Code's `CharCode` enum, as a plain object.
export const CharCode = {
  /**
   * The `\t` character.
   */
  Tab: 9,
  /**
   * The `\n` character.
   */
  LineFeed: 10,
  /**
   * The `\r` character.
   */
  CarriageReturn: 13,
  Space: 32,
  /**
   * The `,` character.
   */
  Comma: 44,
  Digit0: 48,
  Digit9: 57,
  /**
   * The `;` character.
   */
  Semicolon: 59,
  A: 65,
  Z: 90,
  a: 97,
  z: 122,
} as const;
