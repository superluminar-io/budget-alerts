import type { BudgetConfig } from '../../../lib/org/budget-config';

// Mock fs and yaml BEFORE importing the loader
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock('yaml', () => ({
  parse: jest.fn(),
}));

import { existsSync, readFileSync } from 'fs';
import { parse as yamlParse } from 'yaml';
import { loadBudgetConfig } from '../../../lib/org/budget-config-loader';

const mockedExistsSync = existsSync as unknown as jest.MockedFunction<typeof existsSync>;
const mockedReadFileSync = readFileSync as unknown as jest.MockedFunction<typeof readFileSync>;
const mockedYamlParse = yamlParse as unknown as jest.MockedFunction<typeof yamlParse>;

describe('loadBudgetConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws when the config file does not exist', () => {
    mockedExistsSync.mockReturnValue(false);

    expect(() => loadBudgetConfig()).toThrow(/Budget config file not found/);

    expect(mockedExistsSync).toHaveBeenCalledTimes(1);
    expect(mockedReadFileSync).not.toHaveBeenCalled();
    expect(mockedYamlParse).not.toHaveBeenCalled();
  });

  it('loads and returns a valid BudgetConfig from the default path', () => {
    const fakeYaml = 'default: { amount: 100, currency: USD }';
    const fakeConfig: BudgetConfig = {
      default: {
        amount: 100,
        currency: 'USD',
      },
      organizationalUnits: {
        'ou-root': { amount: 200, currency: 'USD' },
        'ou-child': { amount: null },
      },
    };

    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(fakeYaml);
    mockedYamlParse.mockReturnValue(fakeConfig);

    const result = loadBudgetConfig(); // uses default "budget-config.yaml"

    expect(result).toEqual(fakeConfig);

    // ensure it looked for the default file name somewhere in the path
    expect(mockedExistsSync).toHaveBeenCalledTimes(1);
    expect(mockedExistsSync.mock.calls[0][0]).toEqual(
      expect.stringContaining('budget-config.yaml'),
    );

    expect(mockedReadFileSync).toHaveBeenCalledTimes(1);
    expect(mockedReadFileSync.mock.calls[0][0]).toEqual(
      expect.stringContaining('budget-config.yaml'),
    );
    expect(mockedReadFileSync.mock.calls[0][1]).toBe('utf8');

    expect(mockedYamlParse).toHaveBeenCalledWith(fakeYaml);
  });

  it('uses the provided configPath when given', () => {
    const customPath = 'config/org-budgets.yml';
    const fakeYaml = 'whatever: true';
    const fakeConfig: BudgetConfig = {
      default: {
        amount: 50,
        currency: 'EUR',
      },
      organizationalUnits: {},
    };

    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(fakeYaml);
    mockedYamlParse.mockReturnValue(fakeConfig);

    const result = loadBudgetConfig(customPath);

    expect(result).toEqual(fakeConfig);

    expect(mockedExistsSync).toHaveBeenCalledWith(
      expect.stringContaining('config/org-budgets.yml'),
    );
    expect(mockedReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining('config/org-budgets.yml'),
      'utf8',
    );
  });

  it('throws a clear error when YAML parsing fails', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('not: yaml');
    mockedYamlParse.mockImplementation(() => {
      throw new Error('YAML parse error');
    });

    expect(() => loadBudgetConfig('some-file.yml')).toThrow(/Failed to parse budget config YAML/);

    expect(mockedExistsSync).toHaveBeenCalledTimes(1);
    expect(mockedReadFileSync).toHaveBeenCalledTimes(1);
    expect(mockedYamlParse).toHaveBeenCalledTimes(1);
  });

  it('throws when the parsed structure does not match BudgetConfig', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('irrelevant');
    // Missing "default" / "organizationalUnits" etc.
    mockedYamlParse.mockReturnValue({ foo: 'bar' });

    expect(() => loadBudgetConfig('bad-structure.yml')).toThrow(/Invalid budget config structure/);

    expect(mockedYamlParse).toHaveBeenCalledTimes(1);
  });

  it('rejects configs where default.amount is not a number', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('irrelevant');

    const badConfig = {
      default: {
        amount: 'not-a-number',
        currency: 'USD',
      },
      organizationalUnits: {},
    };

    mockedYamlParse.mockReturnValue(badConfig);

    expect(() => loadBudgetConfig('bad-amount.yml')).toThrow(/Invalid budget config structure/);
  });

  it('rejects configs where default.currency is not a string', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('irrelevant');

    const badConfig = {
      default: {
        amount: 100,
        currency: 123,
      },
      organizationalUnits: {},
    };

    mockedYamlParse.mockReturnValue(badConfig);

    expect(() => loadBudgetConfig('bad-currency.yml')).toThrow(/Invalid budget config structure/);
  });

  it('rejects configs where organizationalUnits is missing or not an object', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('irrelevant');

    const badConfig = {
      default: {
        amount: 100,
        currency: 'USD',
      },
      organizationalUnits: null,
    };

    mockedYamlParse.mockReturnValue(badConfig);

    expect(loadBudgetConfig('bad-ous.yml')).toEqual(
      expect.objectContaining({ default: { amount: 100, currency: 'USD' } }),
    );
  });
});
