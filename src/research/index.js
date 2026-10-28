import log from '../logger.js';
import { classifyEmail } from './email.js';
import { getCompanyInfo } from './company.js';
import { findGitHubProfile } from './github.js';

export async function researchMember(memberInfo) {
    const results = [];
    const { domain, type } = classifyEmail(memberInfo.email);

    if (type === 'work') {
        const companyInfo = await getCompanyInfo(domain).catch(error => {
            log.warn(`Could not fetch ${domain}:`, error.message);
            return null;
        });
        if (companyInfo) results.push(companyInfo);
    }

    // personal emails are still worth a github lookup, people often make them public there
    const githubInfo = await findGitHubProfile({
        name: memberInfo.name,
        email: memberInfo.email,
        domain: type === 'work' ? domain : null
    }).catch(error => {
        log.warn('GitHub lookup failed:', error.message);
        return null;
    });
    if (githubInfo) results.push(githubInfo);

    return results;
}
