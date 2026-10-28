import log from '../logger.js';
import { classifyEmail } from './email.js';
import { getCompanyInfo } from './company.js';
import { findGitHubProfile } from './github.js';
import { getWikidataCompany } from './wikidata.js';

const quietly = (label, promise) => promise.catch(error => {
    log.warn(`${label} lookup failed:`, error.message);
    return null;
});

export async function researchMember(memberInfo) {
    const results = [];
    const { domain, type } = classifyEmail(memberInfo.email);

    if (type === 'work') {
        const companyInfo = await quietly('Company', getCompanyInfo(domain));
        if (companyInfo) results.push(companyInfo);

        const wikidataInfo = await quietly('Wikidata', getWikidataCompany(domain));
        if (wikidataInfo) results.push(wikidataInfo);
    }

    // personal emails are still worth a github lookup, people often make them public there
    const githubInfo = await quietly('GitHub', findGitHubProfile({
        name: memberInfo.name,
        email: memberInfo.email,
        domain: type === 'work' ? domain : null
    }));
    if (githubInfo) results.push(githubInfo);

    return results;
}
