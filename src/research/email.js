const personalDomains = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com',
    'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me',
    'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'yandex.ru',
    'zoho.com', 'qq.com', '163.com', '126.com', 'hey.com', 'fastmail.com', 'tutanota.com', 'duck.com'
]);

const domainPattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;

export function isValidDomain(domain) {
    return typeof domain === 'string' && domainPattern.test(domain);
}

export function classifyEmail(email) {
    const value = String(email || '').trim().toLowerCase();
    const at = value.lastIndexOf('@');
    const domain = at > 0 ? value.slice(at + 1) : null;
    if (!isValidDomain(domain)) return { domain: null, type: 'unknown' };

    if (personalDomains.has(domain) || /^(yahoo|hotmail|outlook|live)\.[a-z.]+$/.test(domain)) {
        return { domain, type: 'personal' };
    }
    if (/\.(edu|ac\.[a-z]{2}|edu\.[a-z]{2})$/.test(domain)) {
        return { domain, type: 'academic' };
    }
    return { domain, type: 'work' };
}

// stripe.com -> stripe, acme.co.uk -> acme, mail.google.com -> google
export function domainRoot(domain) {
    const parts = domain.split('.');
    if (parts.length > 2 && parts[parts.length - 2].length <= 3) return parts[parts.length - 3];
    return parts[parts.length - 2];
}
