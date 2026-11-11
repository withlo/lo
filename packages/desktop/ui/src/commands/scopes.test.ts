// @vitest-environment jsdom

import { beforeEach, expect, test } from 'vitest';

import { findScope, hasEditMenu, isTextField, scopeTarget, setScopeSource } from './scopes.ts';

beforeEach(() => {
  document.body.innerHTML = `
    <div data-lo-scope="diff" id="diff">
      <div id="line"></div>
      <div data-lo-scope="box" id="box"><span id="word"></span></div>
    </div>
    <div id="outside"></div>
    <input id="text"><input id="search" type="search"><input id="check" type="checkbox">
    <textarea id="area"></textarea><select id="select"></select>
    <div contenteditable="true"><b id="bold"></b><span contenteditable="false" id="fixed"></span></div>
  `;
});

const at = (id: string) => document.getElementById(id);

test('the scope is the nearest named one, or window', () => {
  expect(findScope(at('line')).name).toBe('diff');
  expect(findScope(at('word')).name).toBe('box');
  expect(findScope(at('box')).name).toBe('box');
  expect(findScope(at('outside'))).toEqual({
    name: 'window',
    element: undefined,
    source: undefined,
  });
  expect(findScope(null).name).toBe('window');
});

test('a scope’s source answers what its keys act on, until it’s taken back', () => {
  const diff = at('diff')!;
  const source = { target: () => ({ kind: 'file', file: 'a.ts' }) as const };
  const remove = setScopeSource(diff, source);
  expect(findScope(at('line')).source).toBe(source);
  expect(scopeTarget(findScope(at('line')))).toEqual({ kind: 'file', file: 'a.ts' });
  // The box inside has a source of its own, or none.
  expect(scopeTarget(findScope(at('word')))).toEqual({ kind: 'none' });
  remove();
  expect(findScope(at('line')).source).toBeUndefined();
});

test('text fields are the inputs that take text, text areas and editable content', () => {
  expect(isTextField(at('text'))).toBe(true);
  expect(isTextField(at('search'))).toBe(true);
  expect(isTextField(at('area'))).toBe(true);
  expect(isTextField(at('bold'))).toBe(true);
  expect(isTextField(at('check'))).toBe(false);
  expect(isTextField(at('select'))).toBe(false);
  expect(isTextField(at('fixed'))).toBe(false);
  expect(isTextField(at('line'))).toBe(false);
  expect(isTextField(null)).toBe(false);
});

test('the Edit menu is for form fields and editable content that is not code', () => {
  document.body.innerHTML = `
    <input id="input"><textarea id="area"></textarea><input id="check" type="checkbox">
    <div contenteditable="true"><b id="plain"></b></div>
    <div data-lo-scope="diff"><div class="cm-editor"><div class="cm-content" contenteditable="true"><span id="diff-text"></span></div>
      <div class="cm-panels"><input id="prompt"></div></div></div>
    <div data-lo-scope="file"><div class="cm-content" contenteditable="true" id="file-text"></div></div>
    <div data-lo-scope="peek"><div class="cm-content" contenteditable="true" id="peek-text"></div></div>
    <div data-lo-scope="box"><div class="cm-content" contenteditable="true" id="box-text"></div></div>
    <div class="cm-content" contenteditable="true" id="bare-text"></div>
    <div data-lo-scope="tree"><div contenteditable="true" id="tree-edit"></div></div>
    <div id="nothing"></div>
  `;
  for (const id of ['input', 'area', 'plain', 'prompt', 'box-text', 'tree-edit']) {
    expect({ id, edit: hasEditMenu(at(id)) }).toEqual({ id, edit: true });
  }
  // Code gets Lo's menu, whatever scope CodeMirror's text sits in.
  for (const id of ['diff-text', 'file-text', 'peek-text', 'bare-text', 'check', 'nothing']) {
    expect({ id, edit: hasEditMenu(at(id)) }).toEqual({ id, edit: false });
  }
  expect(hasEditMenu(null)).toBe(false);
});
