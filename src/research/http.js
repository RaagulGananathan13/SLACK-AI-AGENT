import axios from 'axios';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export const USER_AGENT = 'slack-ai-agent/1.0 (+https://github.com/RaagulGananathan13/SLACK-AI-AGENT)';

const blockList = new net.BlockList();

[
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]
].forEach(([network, prefix]) => blockList.addSubnet(network, prefix, 'ipv4'));

// ipv4-mapped addresses (::ffff:127.0.0.1) are matched against the ipv4 rules by BlockList itself
[
    ['::', 127], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
].forEach(([network, prefix]) => blockList.addSubnet(network, prefix, 'ipv6'));

export function isPrivateAddress(address) {
    const family = net.isIP(address);
    if (family === 0) return true;
    return blockList.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

function safeLookup(hostname, options, callback) {
    dns.lookup(hostname, options, (error, address, family) => {
        if (error) return callback(error);
        const addresses = Array.isArray(address) ? address : [{ address, family }];
        const blocked = addresses.find(entry => isPrivateAddress(entry.address));
        if (blocked) {
            return callback(new Error(`Blocked request to private address ${blocked.address} (${hostname})`));
        }
        callback(null, address, family);
    });
}

// Company sites come from member emails, so a hostile domain could point us at internal
// services. Every connection (redirects included) goes through these agents. Node skips
// `lookup` for ip literals, which is why createConnection checks them separately.
function guarded(Agent) {
    return class extends Agent {
        createConnection(options, callback) {
            if (net.isIP(options.host) && isPrivateAddress(options.host)) {
                callback(new Error(`Blocked request to private address ${options.host}`));
                return undefined;
            }
            return super.createConnection(options, callback);
        }
    };
}

const SafeHttpAgent = guarded(http.Agent);
const SafeHttpsAgent = guarded(https.Agent);

export const httpClient = axios.create({
    timeout: 8000,
    maxRedirects: 3,
    maxContentLength: 2 * 1024 * 1024,
    headers: { 'User-Agent': USER_AGENT },
    httpAgent: new SafeHttpAgent({ lookup: safeLookup }),
    httpsAgent: new SafeHttpsAgent({ lookup: safeLookup })
});
