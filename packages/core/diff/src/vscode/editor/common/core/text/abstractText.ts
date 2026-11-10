/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from '../../../../base/common/assert.ts';
import { Position } from '../position.ts';
import { Range } from '../range.ts';
import { LineRange } from '../ranges/lineRange.ts';
import { TextLength } from '../text/textLength.ts';

// Lo: without the members that convert between offsets and positions, and without `StringText`,
// which the diff doesn't use.
export abstract class AbstractText {
  abstract getValueOfRange(range: Range): string;
  abstract readonly length: TextLength;

  get endPositionExclusive(): Position {
    return this.length.addToPosition(new Position(1, 1));
  }

  get lineRange(): LineRange {
    return this.length.toLineRange();
  }

  getValue(): string {
    return this.getValueOfRange(this.length.toRange());
  }

  getLineLength(lineNumber: number): number {
    return this.getValueOfRange(new Range(lineNumber, 1, lineNumber, Number.MAX_SAFE_INTEGER))
      .length;
  }

  getLineAt(lineNumber: number): string {
    return this.getValueOfRange(new Range(lineNumber, 1, lineNumber, Number.MAX_SAFE_INTEGER));
  }

  getLinesOfRange(range: LineRange): string[] {
    return range.mapToLineArray((lineNumber) => this.getLineAt(lineNumber));
  }

  equals(other: AbstractText): boolean {
    if (this === other) {
      return true;
    }
    return this.getValue() === other.getValue();
  }
}

export class LineBasedText extends AbstractText {
  private readonly _getLineContent: (lineNumber: number) => string;
  private readonly _lineCount: number;

  constructor(_getLineContent: (lineNumber: number) => string, _lineCount: number) {
    assert(_lineCount >= 1);

    super();
    this._getLineContent = _getLineContent;
    this._lineCount = _lineCount;
  }

  override getValueOfRange(range: Range): string {
    if (range.startLineNumber === range.endLineNumber) {
      return this._getLineContent(range.startLineNumber).substring(
        range.startColumn - 1,
        range.endColumn - 1,
      );
    }
    let result = this._getLineContent(range.startLineNumber).substring(range.startColumn - 1);
    for (let i = range.startLineNumber + 1; i < range.endLineNumber; i++) {
      result += '\n' + this._getLineContent(i);
    }
    result += '\n' + this._getLineContent(range.endLineNumber).substring(0, range.endColumn - 1);
    return result;
  }

  override getLineLength(lineNumber: number): number {
    return this._getLineContent(lineNumber).length;
  }

  get length(): TextLength {
    const lastLine = this._getLineContent(this._lineCount);
    return new TextLength(this._lineCount - 1, lastLine.length);
  }
}

export class ArrayText extends LineBasedText {
  constructor(lines: string[]) {
    super((lineNumber) => lines[lineNumber - 1], lines.length);
  }
}
