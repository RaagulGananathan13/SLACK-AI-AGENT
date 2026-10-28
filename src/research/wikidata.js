import axios from 'axios';

import { USER_AGENT } from './http.js';

// wikimedia blocks generic user agents, so this needs the descriptive one
const wikidata = axios.create({
    baseURL: 'https://query.wikidata.org',
    timeout: 10000,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' }
});

// Exact matches on "official website" (P856) use an index. A CONTAINS() filter would
// scan every website on wikidata and time out. The domain is validated before it gets here.
export function buildQuery(domain) {
    const sites = ['https', 'http']
        .flatMap(scheme => [domain, `www.${domain}`].map(host => `${scheme}://${host}`))
        .flatMap(url => [`<${url}>`, `<${url}/>`])
        .join(' ');

    return `SELECT ?company ?companyLabel ?companyDescription ?employees ?inception ?industryLabel ?hqLabel WHERE {
  VALUES ?site { ${sites} }
  ?company wdt:P856 ?site .
  OPTIONAL { ?company wdt:P1128 ?employees . }
  OPTIONAL { ?company wdt:P571 ?inception . }
  OPTIONAL { ?company wdt:P452 ?industry . }
  OPTIONAL { ?company wdt:P159 ?hq . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 30`;
}

export function parseResults(data, domain) {
    const rows = data?.results?.bindings || [];
    if (rows.length === 0) return null;

    const value = (row, key) => row[key]?.value;
    // entities without an english label come back as their Q-id
    const label = (row, key) => {
        const text = value(row, key);
        return text && !/^Q\d+$/.test(text) ? text : null;
    }

    const entity = value(rows[0], 'company');
    const sameCompany = rows.filter(row => value(row, 'company') === entity);
    const first = sameCompany[0];

    const employees = Math.max(0, ...sameCompany.map(row => Number(value(row, 'employees'))).filter(Number.isFinite));
    const industries = [...new Set(sameCompany.map(row => label(row, 'industryLabel')).filter(Boolean))].slice(0, 3);
    const founded = value(first, 'inception')?.slice(0, 4);
    const headquarters = label(first, 'hqLabel');
    const description = value(first, 'companyDescription');

    const facts = [];
    if (description) facts.push(description);
    if (industries.length > 0) facts.push(`industry: ${industries.join(', ')}`);
    if (employees > 0) facts.push(`~${employees.toLocaleString('en-US')} employees`);
    if (founded) facts.push(`founded ${founded}`);
    if (headquarters) facts.push(`HQ: ${headquarters}`);

    return {
        type: 'wikidata',
        url: entity.replace('http://www.wikidata.org/entity/', 'https://www.wikidata.org/wiki/'),
        title: label(first, 'companyLabel') || domain,
        content: facts.join('; ') || 'Listed on Wikidata'
    };
}

export async function getWikidataCompany(domain) {
    const { data } = await wikidata.get('/sparql', {
        params: { query: buildQuery(domain), format: 'json' }
    });
    return parseResults(data, domain);
}
