import { TtlCache } from '../cache.js';
import log from '../logger.js';
import { classifyEmail } from './email.js';
import { getCompanyInfo } from './company.js';
import { findGitHubProfile } from './github.js';
import { getWikidataCompany } from './wikidata.js';

// people from the same company tend to join in waves, no need to hit their site every time
const cache = new TtlCache({ ttl: 24 * 60 * 60 * 1000, max: 1000 });

export async function researchMember(memberInfo) {
    const { domain, type } = classifyEmail(memberInfo.email);
    const sources = [];

    if (type === 'work') {
        sources.push(['company', () => cache.wrap(`company:${domain}`, () => getCompanyInfo(domain))]);
        sources.push(['wikidata', () => cache.wrap(`wikidata:${domain}`, () => getWikidataCompany(domain))]);
    }

    if (memberInfo.email || memberInfo.name) {
        const lookup = {
            name: memberInfo.name,
            email: memberInfo.email,
            domain: type === 'work' ? domain : null
        };
        sources.push(['github', () => cache.wrap(`github:${memberInfo.email || memberInfo.name}`, () => findGitHubProfile(lookup))]);
    }

    const results = await Promise.allSettled(sources.map(([, run]) => run()));

    return results.flatMap((result, i) => {
        if (result.status === 'rejected') {
            log.warn(`${sources[i][0]} research failed:`, result.reason?.message);
            return [];
        }
        return result.value ? [result.value] : [];
    });
}
