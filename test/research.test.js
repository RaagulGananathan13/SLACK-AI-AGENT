import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { classifyEmail, domainRoot } from '../src/research/email.js';
import { parseMetadata, decodeEntities } from '../src/research/company.js';
import { httpClient, isPrivateAddress } from '../src/research/http.js';
import { buildQuery, parseResults } from '../src/research/wikidata.js';
import { normalizeName, pickProfile, worksAt } from '../src/research/github.js';

describe('classifyEmail', () => {
    test('sorts addresses into work, personal and academic', () => {
        assert.deepEqual(classifyEmail('jane@stripe.com'), { domain: 'stripe.com', type: 'work' });
        assert.deepEqual(classifyEmail('Jane@Gmail.com'), { domain: 'gmail.com', type: 'personal' });
        assert.deepEqual(classifyEmail('x@yahoo.co.uk'), { domain: 'yahoo.co.uk', type: 'personal' });
        assert.deepEqual(classifyEmail('s@cs.stanford.edu'), { domain: 'cs.stanford.edu', type: 'academic' });
        assert.deepEqual(classifyEmail('s@ox.ac.uk'), { domain: 'ox.ac.uk', type: 'academic' });
    });

    test('rejects anything that is not a plain public domain', () => {
        const junk = [undefined, '', 'stripe.com', 'a@localhost', 'a@127.0.0.1', 'a@evil.com/x', 'a@exa mple.com', 'a@b@c'];
        for (const value of junk) {
            assert.equal(classifyEmail(value).type, 'unknown', String(value));
        }
    });

    test('domainRoot handles country tlds', () => {
        assert.equal(domainRoot('stripe.com'), 'stripe');
        assert.equal(domainRoot('acme.co.uk'), 'acme');
        assert.equal(domainRoot('mail.google.com'), 'google');
        assert.equal(domainRoot('my.sliit.lk'), 'sliit');
    });
});

describe('company metadata', () => {
    test('reads og tags and description regardless of attribute order', () => {
        const html = `<html><head>
            <title>Acme &amp; Co | Rockets</title>
            <meta data-name="description" content="wrong one">
            <meta content="Acme" property="og:site_name">
            <meta name="description" content='We build &quot;rockets&quot; &#8212; fast.'>
        </head></html>`;

        assert.deepEqual(parseMetadata(html), {
            name: 'Acme',
            title: 'Acme & Co | Rockets',
            description: 'We build "rockets" — fast.'
        });
    });

    test('copes with a page that has no metadata', () => {
        assert.deepEqual(parseMetadata('<p>hello</p>'), { name: '', title: '', description: '' });
    });

    test('decodes numeric entities and leaves broken ones alone', () => {
        assert.equal(decodeEntities('&#x1F680; &#39;hi&#39; &nope; &#0;'), "🚀 'hi' &nope; &#0;");
    });
});

describe('private address guard', () => {
    test('flags internal ranges', () => {
        const internal = ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254',
            '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', 'not-an-ip'];
        internal.forEach(address => assert.equal(isPrivateAddress(address), true, address));
    });

    test('allows public addresses', () => {
        ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']
            .forEach(address => assert.equal(isPrivateAddress(address), false, address));
    });

    describe('http client', () => {
        let server;
        let port;

        before(async () => {
            server = http.createServer((req, res) => res.end('internal')).listen(0, '127.0.0.1');
            await new Promise(resolve => server.on('listening', resolve));
            port = server.address().port;
        });

        after(() => server.close());

        test('refuses ip literals that point inside', async () => {
            await assert.rejects(httpClient.get(`http://127.0.0.1:${port}/`), /Blocked request to private address/);
        });

        test('refuses hostnames that resolve inside', async () => {
            await assert.rejects(httpClient.get(`http://localhost:${port}/`), /Blocked request to private address/);
        });
    });
});

describe('wikidata', () => {
    test('query matches the domain with and without www', () => {
        const query = buildQuery('stripe.com');
        assert.match(query, /<https:\/\/stripe\.com>/);
        assert.match(query, /<http:\/\/www\.stripe\.com\/>/);
    });

    test('merges rows for the same company', () => {
        const row = (extra) => ({
            company: { value: 'http://www.wikidata.org/entity/Q7624104' },
            companyLabel: { value: 'Stripe' },
            companyDescription: { value: 'payment company' },
            inception: { value: '2010-01-01T00:00:00Z' },
            hqLabel: { value: 'San Francisco' },
            ...extra
        });
        const data = {
            results: {
                bindings: [
                    row({ employees: { value: '7000' }, industryLabel: { value: 'financial services' } }),
                    row({ employees: { value: '8000' }, industryLabel: { value: 'financial services' } }),
                    row({ employees: { value: '8000' }, industryLabel: { value: 'Q999999' } })
                ]
            }
        };

        assert.deepEqual(parseResults(data, 'stripe.com'), {
            type: 'wikidata',
            url: 'https://www.wikidata.org/wiki/Q7624104',
            title: 'Stripe',
            content: 'payment company; industry: financial services; ~8,000 employees; founded 2010; HQ: San Francisco'
        });
    });

    test('returns null when nothing matched', () => {
        assert.equal(parseResults({ results: { bindings: [] } }, 'x.io'), null);
    });
});

describe('github matching', () => {
    const jane = { login: 'jdoe', name: 'Jane Doe', company: '@acme' };
    const otherJane = { login: 'janed', name: 'Jane Doe', company: 'Globex' };

    test('normalizes accents, case and punctuation', () => {
        assert.equal(normalizeName('  José  García-López '), 'jose garcia lopez');
    });

    test('worksAt matches whole words only', () => {
        assert.equal(worksAt({ company: '@stripe' }, 'stripe.com'), true);
        assert.equal(worksAt({ blog: 'https://stripe.com/blog' }, 'stripe.com'), true);
        assert.equal(worksAt({ company: 'Stripes Inc' }, 'stripe.com'), false);
        assert.equal(worksAt({ company: '@stripe' }, null), false);
    });

    test('prefers the namesake who works at the member company', () => {
        assert.deepEqual(pickProfile([otherJane, jane], { name: 'jane doe', domain: 'acme.com', total: 2 }), {
            profile: jane,
            confidence: 'high'
        });
    });

    test('trusts a unique name only when there was a single result', () => {
        assert.equal(pickProfile([jane], { name: 'Jane Doe', total: 1 }).confidence, 'medium');
        assert.equal(pickProfile([jane], { name: 'Jane Doe', total: 7 }), null);
    });

    test('gives up on ambiguous or mismatched names', () => {
        assert.equal(pickProfile([jane, otherJane], { name: 'Jane Doe', domain: 'initech.com', total: 2 }), null);
        assert.equal(pickProfile([jane], { name: 'John Roe', total: 1 }), null);
    });
});
