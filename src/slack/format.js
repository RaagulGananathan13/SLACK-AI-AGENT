import { escape } from './blocks.js';

// Models write GitHub markdown whatever the prompt says, and Slack's mrkdwn is different
// enough that **bold** and [links](...) show up as literal characters.
export function toSlackMarkdown(text) {
    return escape(text)
        // escape() also caught the mentions we asked the model to write, put those back
        .replace(/&lt;@([UW][A-Z0-9]+)&gt;/g, '<@$1>')
        .replace(/&lt;#(C[A-Z0-9]+)&gt;/g, '<#$1>')
        .replace(/\*\*(.+?)\*\*/g, '*$1*')
        .replace(/__(.+?)__/g, '*$1*')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<$2|$1>')
        .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
        .replace(/^(\s*)[-*]\s+/gm, '$1• ');
}
