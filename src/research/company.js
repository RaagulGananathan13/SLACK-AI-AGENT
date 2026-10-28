import log from '../logger.js';
import { httpClient } from './http.js';

const namedEntities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
        if (code[0] !== '#') return namedEntities[code.toLowerCase()] ?? match;
        const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    });
}

const tidy = text => text ? decodeEntities(text).replace(/\s+/g, ' ').trim() : '';

function attribute(tag, name) {
    const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

export function parseMetadata(html) {
    const head = html.slice(0, 300000);
    const meta = {};

    for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
        const key = (attribute(tag, 'property') || attribute(tag, 'name'))?.toLowerCase();
        const content = attribute(tag, 'content');
        if (key && content && !(key in meta)) meta[key] = tidy(content);
    }

    return {
        name: meta['og:site_name'] || meta['application-name'] || '',
        title: tidy(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || meta['og:title'] || '',
        description: meta['og:description'] || meta.description || meta['twitter:description'] || ''
    };
}

export async function getCompanyInfo(domain) {
    let lastError;
    for (const url of [`https://${domain}`, `https://www.${domain}`]) {
        try {
            const response = await httpClient.get(url, {
                responseType: 'text',
                headers: { Accept: 'text/html' }
            });
            if (!String(response.headers['content-type']).includes('html')) return null;

            const meta = parseMetadata(response.data);
            return {
                type: 'company',
                url: response.request?.res?.responseUrl || url,
                title: meta.name || meta.title || domain,
                content: meta.description || meta.title || `Company website for ${domain}`
            };
        } catch (error) {
            lastError = error;
            log.debug(`Could not fetch ${url}:`, error.message);
        }
    }
    throw lastError;
}
