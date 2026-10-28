import axios from 'axios';

import log from '../logger.js';

const personalDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com'];

export function isPersonalEmail(email) {
    const domain = email.split('@')[1]?.toLowerCase();
    return personalDomains.includes(domain);
}

export async function researchMember(memberInfo) {
    const results = [];
    try {
        if (memberInfo.email && !isPersonalEmail(memberInfo.email)) {
            const domain = memberInfo.email.split('@')[1];
            const companyInfo = await getCompanyInfo(domain);
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

export async function getCompanyInfo(domain) {
    try {
        const response = await axios.get(`https://www.${domain}`, {
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const titleMatch = response.data.match(/<title>(.*?)<\/title>/i)
        const title = titleMatch ? titleMatch[1] : `Company: ${domain}`;

        return {
            url: `https://www.${domain}`,
            title: title,
            content: `Company website for ${domain}`,
            type: 'company'
        }
    } catch (error) {
        log.error(`Could not fetch ${domain}:`, error.message);
        return null;
    }
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
