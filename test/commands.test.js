import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseMention, parseDays, helpText } from '../src/slack/commands.js';

test('parseMention reads escaped and bare mentions', () => {
    assert.equal(parseMention('<@U012ABC|jane>'), 'U012ABC');
    assert.equal(parseMention('please look at <@W99XYZ>'), 'W99XYZ');
    assert.equal(parseMention('@jane'), null);
    assert.equal(parseMention(''), null);
});

test('parseDays falls back on junk and caps at a year', () => {
    assert.equal(parseDays('14', 7), 14);
    assert.equal(parseDays(undefined, 7), 7);
    assert.equal(parseDays('abc', 7), 7);
    assert.equal(parseDays('-3', 7), 7);
    assert.equal(parseDays('5000', 7), 365);
});

test('help lists every subcommand under the configured name', () => {
    const help = helpText('/scout');
    for (const name of ['analyze', 'leads', 'stats', 'forget']) {
        assert.match(help, new RegExp(`/scout ${name}`));
    }
});
