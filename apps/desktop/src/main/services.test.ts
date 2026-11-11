import { describe, expect, it } from 'vitest';

import { createServices, defineService, findServices, provides } from './services.ts';

const github = defineService<{ login: string }>('accounts.github');
const tabs = defineService<{ open(url: string): void }>('tab.tabs');

describe('defineService', () => {
  it('names a service for the feature that provides it', () => {
    expect(github).toMatchObject({ id: 'accounts.github', feature: 'accounts' });
  });

  it('refuses a name that isn’t <feature>.<name>', () => {
    for (const name of [
      'github',
      'accounts.github.token',
      'Accounts.github',
      'my-feature.github',
    ]) {
      expect(() => defineService(name)).toThrow(`A service is named <feature>.<name>`);
    }
  });
});

describe('findServices', () => {
  it('takes the services among what each service.ts exports', () => {
    expect(
      findServices({
        '../features/accounts/service.ts': { github, kinds: ['user'], default: 'github' },
        '../features/tab/service.ts': { tabs },
      }),
    ).toEqual([github, tabs]);
  });

  it('refuses a service named for a feature other than its folder', () => {
    expect(() => findServices({ '../features/tab/service.ts': { github } })).toThrow(
      '../features/tab/service.ts defines the service accounts.github, but its folder is "tab".',
    );
  });
});

describe('createServices', () => {
  it('answers with what the service’s feature provided, once every feature has', () => {
    const services = createServices();
    const value = { login: 'octocat' };
    services.add('accounts', [provides(github, value)]);
    services.add('tab', []);
    services.ready([github]);
    expect(services.use(github)).toBe(value);
  });

  it('refuses to answer while features are still providing', () => {
    const services = createServices();
    services.add('accounts', [provides(github, { login: 'octocat' })]);
    expect(() => services.use(github)).toThrow(
      'accounts.github was used while features were still providing theirs.',
    );
  });

  it('refuses a service no feature provides', () => {
    const services = createServices();
    services.ready([]);
    expect(() => services.use(tabs)).toThrow('No feature provides tab.tabs.');
  });

  it('takes no more services once ready', () => {
    const services = createServices();
    services.ready([]);
    expect(() => services.add('tab', [provides(tabs, { open() {} })])).toThrow(
      'tab provided services after every feature had.',
    );
  });
});
