import axios from 'axios';

import config from '../config.js';
import { USER_AGENT } from './http.js';
import { domainRoot } from './email.js';

// unauthenticated search is limited to 10 requests a minute, a free token raises it to 30
const github = axios.create({
    baseURL: 'https://api.github.com',
    timeout: 8000,
    headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT,
        ...(config.github.token && { Authorization: `Bearer ${config.github.token}` })
    }
});

export function normalizeName(name) {
    return String(name || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function worksAt(profile, domain) {
    if (!domain) return false;
    const root = domainRoot(domain);
    if (!root || root.length < 3) return false;

    const fields = [profile.company, profile.blog, profile.email].filter(Boolean).join(' ').toLowerCase();
    return fields.includes(domain) || new RegExp(`\\b${root}\\b`).test(fields);
}

// Only accept a profile when it's very likely the same person. A wrong match is worse
// than none, because the model will confidently reason about a stranger.
export function pickProfile(candidates, { name, domain, total = candidates.length }) {
    const wanted = normalizeName(name);
    const sameName = candidates.filter(profile => normalizeName(profile.name) === wanted);
    const atCompany = sameName.filter(profile => worksAt(profile, domain));

    if (atCompany.length === 1) return { profile: atCompany[0], confidence: 'high' };
    if (total === 1 && sameName.length === 1) return { profile: sameName[0], confidence: 'medium' };
    return null;
}

async function searchLogins(query) {
    const { data } = await github.get('/search/users', { params: { q: `${query} type:user`, per_page: 5 } });
    return { total: data.total_count, logins: data.items.map(item => item.login) };
}

async function getProfile(login) {
    const { data } = await github.get(`/users/${encodeURIComponent(login)}`);
    return data;
}

async function getRepoStats(login) {
    const { data } = await github.get(`/users/${encodeURIComponent(login)}/repos`, {
        params: { sort: 'pushed', per_page: 30 }
    });
    const own = data.filter(repo => !repo.fork);
    const counts = {};
    own.forEach(repo => {
        if (repo.language) counts[repo.language] = (counts[repo.language] || 0) + 1;
    });

    return {
        languages: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([language]) => language),
        stars: own.reduce((sum, repo) => sum + repo.stargazers_count, 0)
    };
}

export async function findGitHubProfile({ name, email, domain }) {
    let match = null;

    if (email) {
        const { total, logins } = await searchLogins(`${email} in:email`);
        if (total === 1) {
            match = { profile: await getProfile(logins[0]), confidence: 'high' };
        } else if (total > 1) {
            // the profile api hides emails from anonymous callers, so this only breaks ties
            const profiles = await Promise.all(logins.slice(0, 3).map(getProfile));
            const owner = profiles.find(profile => profile.email?.toLowerCase() === email.toLowerCase());
            if (owner) match = { profile: owner, confidence: 'high' };
        }
    }

    // single names ("alex") match thousands of accounts, not worth a lookup
    if (!match && normalizeName(name).split(' ').length >= 2) {
        const { total, logins } = await searchLogins(`fullname:"${name.replace(/"/g, '')}"`);
        // without a work domain to compare against, only a unique name is trustworthy
        if (total === 1 || (total > 1 && domain)) {
            const candidates = await Promise.all(logins.slice(0, 3).map(getProfile));
            match = pickProfile(candidates, { name, domain, total });
        }
    }

    if (!match) return null;

    const { profile, confidence } = match;
    const { languages, stars } = await getRepoStats(profile.login).catch(() => ({ languages: [], stars: 0 }));

    const facts = [`${profile.public_repos} public repos`, `${profile.followers} followers`];
    if (stars > 0) facts.push(`${stars} stars on own repos`);
    if (languages.length > 0) facts.push(`mostly ${languages.join(', ')}`);
    if (profile.company) facts.push(`company: ${profile.company}`);
    if (profile.bio) facts.push(`bio: ${profile.bio}`);

    return {
        type: 'github',
        url: profile.html_url,
        title: `GitHub: ${profile.login}`,
        content: facts.join(', '),
        confidence
    };
}
