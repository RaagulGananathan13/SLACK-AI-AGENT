const levels = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function enabled(level) {
    const fallback = process.env.NODE_ENV === 'development' ? 'debug' : 'info';
    const min = levels[process.env.LOG_LEVEL] ?? levels[fallback];
    return levels[level] >= min;
}

function write(level, msg, args) {
    if (!enabled(level)) return;
    const out = level === 'error' || level === 'warn' ? console.error : console.log;

    if (process.env.LOG_FORMAT === 'json') {
        const entry = { time: new Date().toISOString(), level, msg };
        if (args.length) entry.data = args.map(arg => arg instanceof Error ? arg.message : arg);
        return out(JSON.stringify(entry));
    }
    out(`[${level.toUpperCase()}] ${msg}`, ...args);
}

const log = {
    debug: (msg, ...args) => write('debug', msg, args),
    info: (msg, ...args) => write('info', msg, args),
    warn: (msg, ...args) => write('warn', msg, args),
    error: (msg, ...args) => write('error', msg, args)
}

export default log;
