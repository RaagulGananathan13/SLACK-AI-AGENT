import axios from 'axios';

import log from '../logger.js';
import { classifyEmail } from './email.js';
import { getCompanyInfo } from './company.js';

export async function researchMember(memberInfo) {
    const results = [];
    const { domain, type } = classifyEmail(memberInfo.email);

    try {
        if (type === 'work') {
            const companyInfo = await getCompanyInfo(domain).catch(error => {
                log.warn(`Could not fetch ${domain}:`, error.message);
                return null;
            });
            if (companyInfo) results.push(companyInfo);

            if (memberInfo.name) {
                const githubInfo = await getGitHubInfo(memberInfo.name);
                if (githubInfo) results.push(githubInfo);
            }
        }
    } catch (error) {
        log.error('Research error:', error.message);
    }
    return results;
}

export async function getGitHubInfo(name) {
    try {
        const response = await axios.get(
            `https://api.github.com/search/users?q=${encodeURIComponent(name)}`,
            { timeout: 5000 }
        );

        if (response.data.items && response.data.items.length > 0) {
            const user = response.data.items[0];
            return {
                url: user.html_url,
                title: `GitHub: ${user.login}`,
                content: `${user.public_repos} public repositories`,
                type: 'github'
            }
        }
    } catch (error) {
        log.debug('GitHub search error:', error.message)
    }
    return null;
}
